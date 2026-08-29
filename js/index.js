// ============================================================
// VARIÁVEIS GLOBAIS
// Ficam fora das funções para que todas as funções possam acessá-las
// ============================================================

let peer = null;          // Objeto PeerJS — representa a conexão deste transmissor na rede P2P
let localStream = null;   // Stream de vídeo/áudio capturado da tela do usuário
let timerInterval = null; // Referência ao setInterval do cronômetro (para poder pausá-lo depois)
let secondsElapsed = 0;   // Contador de segundos desde o início da transmissão

// ============================================================
// CONFIGURAÇÃO DO PEERJS (ICE SERVERS / STUN)
// STUN = protocolo que ajuda dois navegadores a se encontrarem
// mesmo estando em redes diferentes (ex: um em casa, outro no trabalho)
// Aqui usamos os servidores STUN gratuitos do Google
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
// MAPA DE RESOLUÇÕES
// Relaciona o valor do <select> (ex: "1080") com
// a largura e altura reais em pixels para passar ao navegador
// ============================================================
const resolucoes = {
  "720":  { width: 1280,  height: 720  },  // HD
  "1080": { width: 1920,  height: 1080 },  // Full HD
  "1440": { width: 2560,  height: 1440 },  // 2K
  "2160": { width: 3840,  height: 2160 }   // 4K
};

// ============================================================
// FUNÇÃO: startTimer
// Inicia o cronômetro que aparece na barra de status ("AO VIVO")
// Usa setInterval para executar a cada 1 segundo (1000ms)
// e atualiza o texto no formato HH:MM:SS
// ============================================================
function startTimer() {
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    // Divide o total de segundos para obter horas, minutos e segundos separados
    const hrs  = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(secondsElapsed % 60).padStart(2, '0');
    // Atualiza o elemento <span id="timer"> na tela
    document.getElementById('timer').innerText = `${hrs}:${mins}:${secs}`;
  }, 1000);
}

// ============================================================
// FUNÇÃO: stopTimer
// Para o cronômetro e reseta o texto para 00:00:00
// clearInterval cancela o setInterval iniciado em startTimer()
// ============================================================
function stopTimer() {
  clearInterval(timerInterval);
  document.getElementById('timer').innerText = "00:00:00";
}

// ============================================================
// FUNÇÃO: copiarLink
// Seleciona o texto do input com o link do espectador
// e copia para a área de transferência do usuário
// ============================================================
function copiarLink() {
  const input = document.getElementById('shareLink');
  input.select(); // Seleciona visualmente o texto no campo
  navigator.clipboard.writeText(input.value); // Copia para o clipboard
  alert("Link copiado!");
}

// ============================================================
// FUNÇÃO: iniciar  (async = pode usar "await" dentro dela)
// Fluxo principal quando o usuário clica em "Iniciar Transmissão":
//   1. Lê as configurações escolhidas (resolução e FPS)
//   2. Captura a tela com getDisplayMedia
//   3. Mostra preview local no <video>
//   4. Cria um Peer com ID único para receber espectadores
//   5. Gera o link de espectador e exibe na tela
//   6. Quando um espectador conecta, envia o stream para ele
// ============================================================
async function iniciar() {
  // Lê os valores dos <select> na página
  const resKey    = document.getElementById('resSelect').value;      // ex: "1080"
  const fpsVal    = parseInt(document.getElementById('fpsSelect').value); // ex: 60
  const resConfig = resolucoes[resKey]; // Busca { width, height } no mapa acima

  try {
    // getDisplayMedia = API do navegador que pede permissão para capturar a tela
    // Retorna um MediaStream com trilhas de vídeo (e áudio, se disponível)
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width:     { ideal: resConfig.width },   // Pede a resolução ideal escolhida
        height:    { ideal: resConfig.height },
        frameRate: { ideal: fpsVal }             // Pede o FPS ideal escolhido
      },
      audio: true,                               // Captura áudio do sistema também
      selfBrowserSurface: "exclude"              // Impede que o próprio navegador apareça como opção
    });

    // Exibe o stream localmente no <video id="preview"> para o transmissor ver o que está enviando
    const previewVideo = document.getElementById('preview');
    previewVideo.srcObject = localStream;
    previewVideo.muted = true; // Mudo para não dar eco no próprio transmissor

    // Se o usuário parar o compartilhamento de tela pelo botão do próprio navegador,
    // a função parar() é chamada automaticamente
    localStream.getVideoTracks()[0].onended = () => parar();

    // Gera um ID de sala aleatório, ex: "live-k3f9xz"
    // Esse ID é o que os espectadores usam para se conectar
    const roomId = 'live-' + Math.random().toString(36).substring(2, 8);

    // Cria o objeto Peer com o ID gerado e a configuração de ICE servers
    peer = new Peer(roomId, peerConfig);

    // Evento 'open': disparado quando a conexão com o servidor de sinalização PeerJS foi estabelecida
    // Só depois daqui o transmissor está "visível" para espectadores
    peer.on('open', (id) => {
      // Monta o link completo para o espectador, ex:
      // "http://localhost:5500/espectador.html?room=live-k3f9xz"
      const baseUrl  = window.location.href.replace('index.html', '').split('?')[0];
      const fullLink = `${baseUrl}espectador.html?room=${id}`;

      // Atualiza a interface: mostra o link, a barra de status e troca os botões
      document.getElementById('shareLink').value            = fullLink;
      document.getElementById('linkArea').style.display    = 'block';
      document.getElementById('statusBar').style.display   = 'flex';
      document.getElementById('qualidadeBadge').innerText  = `${resKey}p @ ${fpsVal}FPS`;

      document.getElementById('startBtn').style.display = 'none';  // Esconde "Iniciar"
      document.getElementById('stopBtn').style.display  = 'block'; // Mostra "Parar"

      startTimer(); // Inicia o cronômetro de tempo ao vivo
    });

    // Evento 'connection': disparado quando um espectador abre o link e se conecta
    // O PeerJS usa essa conexão de dados para saber o ID do espectador
    peer.on('connection', (conn) => {
      // Quando a conexão de dados estiver aberta, fazemos a chamada de vídeo para o espectador
      conn.on('open', () => {
        // peer.call() = inicia uma "chamada" P2P enviando o localStream para o espectador
        const call = peer.call(conn.peer, localStream);

        // Ajusta o bitrate máximo de vídeo via WebRTC RTCRtpSender
        if (call && call.peerConnection) {
          call.peerConnection.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'video') {
              const parameters = sender.getParameters();
              if (!parameters.encodings) parameters.encodings = [{}];

              // Bitrate padrão: 12 Mbps (suficiente para 1080p/60fps)
              // Para resoluções altas (1440p/4K) ou FPS alto (120+): usa 30 Mbps
              let targetBitrate = 12000000;
              if (resKey === "1440" || resKey === "2160" || fpsVal >= 120) {
                targetBitrate = 30000000;
              }

              parameters.encodings[0].maxBitrate = targetBitrate;
              sender.setParameters(parameters).catch(e => console.error(e));
            }
          });
        }
      });
    });

  } catch (err) {
    // Se o usuário cancelar a captura de tela ou o navegador não suportar, mostra o erro
    alert("Erro ao iniciar transmissão: " + err.message);
  }
}

// ============================================================
// FUNÇÃO: parar
// Encerra a transmissão completamente:
//   1. Para todas as trilhas de mídia (libera a câmera/tela)
//   2. Destrói o objeto Peer (desconecta da rede P2P)
//   3. Para o cronômetro
//   4. Reseta a interface para o estado inicial
// ============================================================
function parar() {
  // Para cada trilha de mídia (vídeo, áudio) e libera os recursos do sistema
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Destrói a conexão PeerJS, desconectando todos os espectadores
  if (peer) {
    peer.destroy();
    peer = null;
  }

  stopTimer(); // Para e reseta o cronômetro

  // Reseta a interface para o estado antes de iniciar
  document.getElementById('preview').srcObject  = null;
  document.getElementById('linkArea').style.display   = 'none';
  document.getElementById('statusBar').style.display  = 'none';
  document.getElementById('startBtn').style.display   = 'block'; // Volta a mostrar "Iniciar"
  document.getElementById('stopBtn').style.display    = 'none';  // Esconde "Parar"
}
