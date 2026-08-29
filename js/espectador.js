// ============================================================
// CONFIGURAÇÃO DO PEERJS (ICE SERVERS / STUN)
// Mesma configuração usada no transmissor.
// STUN = ajuda dois navegadores a se encontrarem na internet,
// descobrindo o IP público de cada um para estabelecer conexão direta.
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
// Quando o transmissor gera o link, ele fica assim:
//   espectador.html?room=live-k3f9xz
// URLSearchParams lê os parâmetros depois do "?" na URL
// então urlParams.get('room') retorna "live-k3f9xz"
// ============================================================
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room'); // null se não tiver ?room= na URL

// Referências aos elementos HTML para atualizar a interface
const statusOverlay = document.getElementById('statusOverlay'); // Texto de status sobreposto ao vídeo
const remoteVideo   = document.getElementById('remoteVideo');   // Elemento <video> onde o stream será exibido

// ============================================================
// FLUXO PRINCIPAL
// Verifica se tem um roomId válido na URL antes de tentar conectar
// ============================================================
if (!roomId) {
  // Se o espectador abriu a página sem o parâmetro ?room=, mostra erro
  statusOverlay.innerText = "Código de transmissão não encontrado no link.";
} else {
  // ============================================================
  // CRIA O PEER DO ESPECTADOR
  // Diferente do transmissor, o espectador não precisa de um ID fixo —
  // o PeerJS gera um ID aleatório automaticamente para ele.
  // ============================================================
  const viewerPeer = new Peer(peerConfig);

  // Evento 'open': disparado quando o espectador está conectado ao servidor
  // de sinalização do PeerJS e pronto para se comunicar
  viewerPeer.on('open', (viewerId) => {
    statusOverlay.innerText = "Procurando transmissor...";

    // Abre uma conexão de DADOS com o transmissor usando o roomId da URL
    // Essa conexão serve para "avisar" o transmissor que há um espectador novo
    // (o transmissor escuta esse evento e então inicia a chamada de vídeo)
    const conn = viewerPeer.connect(roomId);

    conn.on('open', () => {
      // Conexão de dados estabelecida — agora aguarda o transmissor iniciar a chamada de vídeo
      statusOverlay.innerText = "Aguardando sinal de vídeo...";
    });

    conn.on('error', (err) => {
      statusOverlay.innerText = "Erro na conexão de dados: " + err;
    });
  });

  // ============================================================
  // EVENTO 'call': disparado quando o TRANSMISSOR faz peer.call()
  // enviando o stream de vídeo para este espectador
  // ============================================================
  viewerPeer.on('call', (call) => {
    // call.answer() = espectador aceita a chamada (sem enviar stream de volta,
    // pois é apenas espectador — não precisa transmitir nada)
    call.answer();

    // Evento 'stream': disparado quando o stream de vídeo do transmissor chega
    call.on('stream', (remoteStream) => {
      statusOverlay.style.display = 'none'; // Esconde o overlay de status
      remoteVideo.srcObject = remoteStream;  // Conecta o stream ao elemento <video>

      // Tenta dar play automaticamente no vídeo
      // Navegadores modernos bloqueiam autoplay com áudio sem interação do usuário
      remoteVideo.play().catch(() => {
        // Se o autoplay for bloqueado, mostra um aviso pedindo que o usuário clique
        statusOverlay.style.display = 'block';
        statusOverlay.innerText = "Clique na tela para iniciar o áudio/vídeo";

        // Aguarda um clique do usuário para tentar dar play novamente
        // { once: true } = remove o listener automaticamente após o primeiro clique
        window.addEventListener('click', () => {
          remoteVideo.play();
          statusOverlay.style.display = 'none';
        }, { once: true });
      });
    });

    // Evento 'close': disparado quando o transmissor encerra a transmissão (chama parar())
    call.on('close', () => {
      statusOverlay.style.display = 'block';
      statusOverlay.innerText = "A transmissão foi encerrada.";
    });
  });

  // ============================================================
  // TRATAMENTO DE ERROS DO PEER
  // Cobre casos como: roomId inexistente, transmissor offline,
  // falha na conexão WebRTC, etc.
  // err.type retorna o tipo do erro (ex: "peer-unavailable", "network")
  // ============================================================
  viewerPeer.on('error', (err) => {
    statusOverlay.style.display = 'block';
    statusOverlay.innerText = "Erro ao conectar: " + err.type;
  });
}
