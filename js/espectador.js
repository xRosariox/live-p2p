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
// Usa o candidato de par ativo para ler currentRoundTripTime,
// que representa o RTT da conexão ICE em segundos.
// ============================================================
function startLatencyTracking(call) {
  activeCall = call;

  statsInterval = setInterval(async () => {
    if (!activeCall?.peerConnection) return;

    try {
      const stats = await activeCall.peerConnection.getStats();

      stats.forEach(report => {
        // Procura pelo candidato de par ICE ativo com RTT disponível
        if (
          report.type === 'candidate-pair' &&
          report.state === 'succeeded' &&
          report.currentRoundTripTime !== undefined
        ) {
          const latencyMs = Math.round(report.currentRoundTripTime * 1000);
          metricLatency.textContent = `Latência: ${latencyMs}ms`;
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
function showMetrics(call) {
  metricsOverlay.classList.add('visible');
  metricsToggle.classList.add('active');

  startLiveTimer();
  startFpsTracking();
  startLatencyTracking(call);
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
}

// ============================================================
// BOTÃO TOGGLE — oculta/mostra o overlay de métricas
// ============================================================
metricsToggle.addEventListener('click', () => {
  const isVisible = metricsOverlay.classList.toggle('visible');
  metricsToggle.title = isVisible ? 'Ocultar métricas' : 'Mostrar métricas';
});

// ============================================================
// FLUXO PRINCIPAL
// ============================================================
if (!roomId) {
  setStatus("Código de transmissão não encontrado no link.");
} else {
  const viewerPeer = new Peer(peerConfig);

  viewerPeer.on('open', (viewerId) => {
    setStatus("Procurando transmissor...");

    const conn = viewerPeer.connect(roomId);

    conn.on('open', () => {
      setStatus("Aguardando sinal de vídeo...");
    });

    conn.on('error', (err) => {
      setStatus("Erro na conexão de dados: " + err);
    });
  });

  viewerPeer.on('call', (call) => {
    call.answer();

    call.on('stream', (remoteStream) => {
      statusOverlay.style.display = 'none';
      remoteVideo.srcObject = remoteStream;

      // Badge do header fica verde
      if (streamBadge) {
        streamBadge.textContent = 'Ao vivo';
        streamBadge.classList.add('online');
      }

      remoteVideo.play().catch(() => {
        // Autoplay bloqueado — aguarda clique no botão de play do player
      });

      // Inicia métricas assim que o stream chegar
      showMetrics(call);
    });

    call.on('close', () => {
      stopMetrics();
      statusOverlay.style.display = 'flex';
      setStatus("A transmissão foi encerrada.");
      if (streamBadge) {
        streamBadge.textContent = 'Encerrada';
        streamBadge.classList.remove('online');
      }
    });
  });

  viewerPeer.on('error', (err) => {
    statusOverlay.style.display = 'flex';
    setStatus("Erro ao conectar: " + err.type);
  });
}
