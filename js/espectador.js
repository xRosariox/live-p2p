// ============================================================
// CONFIGURAÇÃO DO PEERJS (ICE SERVERS / STUN)
// ============================================================
const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
};

// ============================================================
// LÊ O ID DA SALA DA URL
// ============================================================
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

// Referências aos elementos HTML
const statusOverlay  = document.getElementById('statusOverlay');
const statusText     = document.getElementById('statusText');
const streamBadge    = document.getElementById('streamBadge');
const remoteVideo    = document.getElementById('remoteVideo');
const metricsOverlay = document.getElementById('metricsOverlay');
const metricsToggle  = document.getElementById('metricsToggle');
const liveTimer      = document.getElementById('liveTimer');
const metricFps      = document.getElementById('metricFps');
const metricLatency  = document.getElementById('metricLatency');
const fullscreenBtn  = document.getElementById('fullscreenBtn');
const fsIconExpand   = document.getElementById('fsIconExpand');
const fsIconCollapse = document.getElementById('fsIconCollapse');
const videoContainer = document.querySelector('.video-container');

// Atualiza texto de status no overlay e no badge do header
function setStatus(text) {
  if (statusText)  statusText.innerText = text;
  if (streamBadge) streamBadge.textContent = text;
}

// ============================================================
// MÉTRICAS — variáveis de controle
// ============================================================
let watchStartTime   = null; // momento em que o stream iniciou
let timerInterval    = null; // intervalo do timer AO VIVO
let fpsInterval      = null; // intervalo de leitura de FPS
let statsInterval    = null; // intervalo de leitura de latência
let lastFrameCount   = 0;    // frames contados no ciclo anterior
let activeCall       = null; // referência à call ativa (para getStats)

// Qualidade adaptativa: níveis de bitrate que o espectador pode solicitar
// O transmissor aplica o valor recebido via setParameters
const QUALITY_LEVELS = [
  { label: 'alta',   maxBitrate: 12_000_000 }, // padrão — boa rede
  { label: 'média',  maxBitrate:  4_000_000 }, // latência moderada
  { label: 'baixa',  maxBitrate:  1_500_000 }, // latência alta
];
let currentQualityIndex = 0; // começa no nível mais alto
let highLatencyCount    = 0; // contagem de amostras com latência alta
let lowLatencyCount     = 0; // contagem de amostras com latência baixa
const SAMPLES_TO_CHANGE = 3; // amostras consecutivas antes de mudar de nível

// ============================================================
// FORMATA SEGUNDOS EM HH:MM:SS
// ============================================================
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

// ============================================================
// INICIA O TIMER AO VIVO
// ============================================================
function startLiveTimer() {
  watchStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - watchStartTime) / 1000);
    liveTimer.textContent = formatTime(elapsed);
  }, 1000);
}

// ============================================================
// INICIA LEITURA DE FPS
// Usa requestVideoFrameCallback quando disponível (mais preciso),
// com fallback para leitura periódica via getVideoPlaybackQuality.
// ============================================================
function startFpsTracking() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    // Método moderno — conta frames individuais
    let frameCount = 0;
    let lastTime   = performance.now();

    function onFrame(now) {
      frameCount++;
      const elapsed = now - lastTime;

      if (elapsed >= 1000) {
        const fps = Math.round((frameCount / elapsed) * 1000);
        metricFps.textContent = `FPS: ${fps}`;
        frameCount = 0;
        lastTime   = now;
      }

      remoteVideo.requestVideoFrameCallback(onFrame);
    }

    remoteVideo.requestVideoFrameCallback(onFrame);

  } else {
    // Fallback — usa getVideoPlaybackQuality (disponível na maioria dos navegadores)
    fpsInterval = setInterval(() => {
      const quality = remoteVideo.getVideoPlaybackQuality?.();
      if (!quality) return;

      const currentFrames = quality.totalVideoFrames;
      const fps = currentFrames - lastFrameCount;
      lastFrameCount = currentFrames;
      metricFps.textContent = `FPS: ${fps}`;
    }, 1000);
  }
}

// ============================================================
// INICIA LEITURA DE LATÊNCIA via RTCPeerConnection.getStats()
// Também aplica qualidade adaptativa: se a latência ficar alta
// por 3 amostras consecutivas, pede ao transmissor para reduzir
// o bitrate via mensagem de dados (conn.send).
// ============================================================
function startLatencyTracking(call, conn) {
  activeCall = call;

  statsInterval = setInterval(async () => {
    if (!activeCall?.peerConnection) return;

    try {
      const stats = await activeCall.peerConnection.getStats();

      stats.forEach(report => {
        if (
          report.type === 'candidate-pair' &&
          report.state === 'succeeded' &&
          report.currentRoundTripTime !== undefined
        ) {
          const latencyMs = Math.round(report.currentRoundTripTime * 1000);
          metricLatency.textContent = `Latência: ${latencyMs}ms`;

          // ── Qualidade adaptativa ──
          // Latência acima de 200ms: conta amostras ruins → pede redução de qualidade
          if (latencyMs > 200) {
            highLatencyCount++;
            lowLatencyCount = 0;

            if (
              highLatencyCount >= SAMPLES_TO_CHANGE &&
              currentQualityIndex < QUALITY_LEVELS.length - 1
            ) {
              currentQualityIndex++;
              highLatencyCount = 0;
              const nivel = QUALITY_LEVELS[currentQualityIndex];
              console.info(`[Qualidade adaptativa] Latência alta (${latencyMs}ms) → reduzindo para ${nivel.label}`);
              conn?.send?.({ type: 'quality', maxBitrate: nivel.maxBitrate });
            }

          // Latência abaixo de 80ms: conta amostras boas → tenta subir qualidade
          } else if (latencyMs < 80) {
            lowLatencyCount++;
            highLatencyCount = 0;

            if (
              lowLatencyCount >= SAMPLES_TO_CHANGE * 2 && // exige mais amostras para subir
              currentQualityIndex > 0
            ) {
              currentQualityIndex--;
              lowLatencyCount = 0;
              const nivel = QUALITY_LEVELS[currentQualityIndex];
              console.info(`[Qualidade adaptativa] Latência boa (${latencyMs}ms) → subindo para ${nivel.label}`);
              conn?.send?.({ type: 'quality', maxBitrate: nivel.maxBitrate });
            }

          } else {
            // Latência estável — reseta os contadores
            highLatencyCount = 0;
            lowLatencyCount  = 0;
          }
        }
      });
    } catch {
      // Silencia erros de stats (ex: conexão encerrada)
    }
  }, 1000);
}

// ============================================================
// EXIBE AS MÉTRICAS QUANDO O STREAM INICIA
// ============================================================
function showMetrics(call, conn) {
  metricsOverlay.classList.add('visible');
  metricsToggle.classList.add('active');

  startLiveTimer();
  startFpsTracking();
  startLatencyTracking(call, conn);
}

// ============================================================
// PARA TODAS AS MÉTRICAS (quando a live encerra)
// ============================================================
function stopMetrics() {
  clearInterval(timerInterval);
  clearInterval(fpsInterval);
  clearInterval(statsInterval);
  metricsOverlay.classList.remove('visible');
  metricsToggle.classList.remove('active');
  fullscreenBtn.classList.remove('active');
  if (document.fullscreenElement) document.exitFullscreen();
}

// ============================================================
// BOTÃO TOGGLE — oculta/mostra o overlay de métricas
// ============================================================
metricsToggle.addEventListener('click', () => {
  const isVisible = metricsOverlay.classList.toggle('visible');
  metricsToggle.title = isVisible ? 'Ocultar métricas' : 'Mostrar métricas';
});

// ============================================================
// BOTÃO FULLSCREEN
// Usa a Fullscreen API nativa do navegador.
// Entra em fullscreen no container do player (não só no <video>)
// para manter as métricas e controles visíveis.
// ============================================================
function atualizarIconeFullscreen() {
  const estaFull = !!document.fullscreenElement;
  fsIconExpand.style.display   = estaFull ? 'none'  : 'block';
  fsIconCollapse.style.display = estaFull ? 'block' : 'none';
  fullscreenBtn.title = estaFull ? 'Sair da tela cheia' : 'Tela cheia';
}

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    videoContainer.requestFullscreen().catch(err => {
      console.warn('Fullscreen não suportado:', err);
    });
  } else {
    document.exitFullscreen();
  }
});

// Sincroniza o ícone quando o usuário sai do fullscreen pelo Esc
document.addEventListener('fullscreenchange', atualizarIconeFullscreen);

// Ativa o botão de fullscreen quando o stream chegar (junto com as métricas)
function ativarControlesPlayer() {
  fullscreenBtn.classList.add('active');
}

// ============================================================
// VALIDA O ROOM ID
// Aceita apenas letras, números e hífen, com comprimento razoável.
// Evita strings maliciosas ou vazias que poderiam causar erros.
// ============================================================
function isValidRoomId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{3,64}$/.test(id);
}

// ============================================================
// FLUXO PRINCIPAL
// ============================================================

// Sem room na URL
if (!roomId) {
  setStatus("Código de transmissão não encontrado no link.");

// Room inválido (injeção, string estranha, etc.)
} else if (!isValidRoomId(roomId)) {
  setStatus("Link de transmissão inválido.");

} else {

  let viewerPeer      = null;
  let connectionTimer = null; // timeout de 15s esperando o stream chegar
  let streamReceived  = false;
  let reconnectTimer  = null;
  let reconnectCount  = 0;
  const MAX_RECONNECT = 5; // tentativas máximas de reconexão

  // ── Encerra o timer de timeout se o stream chegou ──
  function clearConnectionTimer() {
    if (connectionTimer) {
      clearTimeout(connectionTimer);
      connectionTimer = null;
    }
  }

  // ── Mostra overlay de erro ──
  function showError(msg) {
    clearConnectionTimer();
    stopMetrics();
    statusOverlay.style.display = 'flex';
    setStatus(msg);
    if (streamBadge) {
      streamBadge.textContent = 'Encerrada';
      streamBadge.classList.remove('online');
    }
  }

  // ── Tenta conectar ao transmissor ──
  function conectar() {
    streamReceived = false;

    viewerPeer = new Peer(peerConfig);

    viewerPeer.on('open', () => {
      setStatus(reconnectCount > 0
        ? `Reconectando... (tentativa ${reconnectCount}/${MAX_RECONNECT})`
        : "Procurando transmissor...");

      const conn = viewerPeer.connect(roomId);

      // ── Timeout: se em 15s o stream não chegar, avisa o usuário ──
      connectionTimer = setTimeout(() => {
        if (!streamReceived) {
          showError("Transmissão não encontrada ou transmissor offline.");
        }
      }, 15000);

      conn.on('open', () => {
        setStatus("Aguardando sinal de vídeo...");
      });

      // ── Cleanup correto quando a conexão de dados fechar ──
      conn.on('close', () => {
        if (!streamReceived) {
          clearConnectionTimer();
          tentarReconectar();
        }
      });

      conn.on('error', (err) => {
        clearConnectionTimer();
        setStatus("Erro na conexão: " + err);
        tentarReconectar();
      });
    });

    // ── Recebe a chamada de vídeo do transmissor ──
    viewerPeer.on('call', (call) => {
      call.answer();

      call.on('stream', (remoteStream) => {
        streamReceived = true;
        clearConnectionTimer();
        reconnectCount = 0; // reseta contador ao conectar com sucesso

        statusOverlay.style.display = 'none';
        remoteVideo.srcObject = remoteStream;

        if (streamBadge) {
          streamBadge.textContent = 'Ao vivo';
          streamBadge.classList.add('online');
        }

        remoteVideo.play().catch(() => {
          // Autoplay bloqueado — usuário pode dar play manualmente
        });

        ativarControlesPlayer();
        showMetrics(call, conn);
      });

      // ── Transmissão encerrada pelo transmissor ──
      call.on('close', () => {
        showError("A transmissão foi encerrada.");
      });

      call.on('error', () => {
        showError("Erro na transmissão de vídeo.");
        tentarReconectar();
      });
    });

    viewerPeer.on('error', (err) => {
      clearConnectionTimer();
      // peer-unavailable = transmissor não existe (ainda) — vale tentar reconectar
      if (err.type === 'peer-unavailable') {
        tentarReconectar();
      } else {
        showError("Erro ao conectar: " + err.type);
      }
    });
  }

  // ── Reconexão automática com backoff exponencial ──
  function tentarReconectar() {
    if (reconnectCount >= MAX_RECONNECT) {
      showError("Não foi possível conectar à transmissão após várias tentativas.");
      return;
    }

    reconnectCount++;

    // Destrói o peer atual antes de criar um novo
    if (viewerPeer && !viewerPeer.destroyed) {
      viewerPeer.destroy();
    }

    stopMetrics();

    // Backoff: 2s, 4s, 8s, 16s, 32s
    const delay = Math.min(2000 * Math.pow(2, reconnectCount - 1), 30000);
    setStatus(`Reconectando em ${Math.round(delay / 1000)}s... (${reconnectCount}/${MAX_RECONNECT})`);

    reconnectTimer = setTimeout(() => {
      conectar();
    }, delay);
  }

  // Inicia a conexão
  conectar();
}
