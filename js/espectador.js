const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
};

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const statusOverlay = document.getElementById('statusOverlay');
const remoteVideo = document.getElementById('remoteVideo');

if (!roomId) {
  statusOverlay.innerText = "Código de transmissão não encontrado no link.";
} else {
  const viewerPeer = new Peer(peerConfig);

  viewerPeer.on('open', (viewerId) => {
    statusOverlay.innerText = "Procurando transmissor...";

    const conn = viewerPeer.connect(roomId);

    conn.on('open', () => {
      statusOverlay.innerText = "Aguardando sinal de vídeo...";
    });

    conn.on('error', (err) => {
      statusOverlay.innerText = "Erro na conexão de dados: " + err;
    });
  });

  viewerPeer.on('call', (call) => {
    call.answer();

    call.on('stream', (remoteStream) => {
      statusOverlay.style.display = 'none';
      remoteVideo.srcObject = remoteStream;

      remoteVideo.play().catch(() => {
        statusOverlay.style.display = 'block';
        statusOverlay.innerText = "Clique na tela para iniciar o áudio/vídeo";
        
        window.addEventListener('click', () => {
          remoteVideo.play();
          statusOverlay.style.display = 'none';
        }, { once: true });
      });
    });

    call.on('close', () => {
      statusOverlay.style.display = 'block';
      statusOverlay.innerText = "A transmissão foi encerrada.";
    });
  });

  viewerPeer.on('error', (err) => {
    statusOverlay.style.display = 'block';
    statusOverlay.innerText = "Erro ao conectar: " + err.type;
  });
}