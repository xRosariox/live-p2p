let peer = null;
let localStream = null;
let timerInterval = null;
let secondsElapsed = 0;

const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
};
const resolucoes = {
  "720": { width: 1280, height: 720 },
  "1080": { width: 1920, height: 1080 },
  "1440": { width: 2560, height: 1440 },
  "2160": { width: 3840, height: 2160 }
};
function startTimer() {
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const hrs = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(secondsElapsed % 60).padStart(2, '0');
    document.getElementById('timer').innerText = `${hrs}:${mins}:${secs}`;
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
  document.getElementById('timer').innerText = "00:00:00";
}
function copiarLink() {
  const input = document.getElementById('shareLink');
  input.select();
  navigator.clipboard.writeText(input.value);
  alert("Link copiado!");
}
async function iniciar() {
  const resKey = document.getElementById('resSelect').value;
  const fpsVal = parseInt(document.getElementById('fpsSelect').value);
  const resConfig = resolucoes[resKey];

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: resConfig.width },
        height: { ideal: resConfig.height },
        frameRate: { ideal: fpsVal }
      },
      audio: true,
      selfBrowserSurface: "exclude"
    });

    const previewVideo = document.getElementById('preview');
    previewVideo.srcObject = localStream;
    previewVideo.muted = true;

    localStream.getVideoTracks()[0].onended = () => parar();

    const roomId = 'live-' + Math.random().toString(36).substring(2, 8);
    peer = new Peer(roomId, peerConfig);

    peer.on('open', (id) => {
      const baseUrl = window.location.href.replace('index.html', '').split('?')[0];
      const fullLink = `${baseUrl}espectador.html?room=${id}`;
      
      document.getElementById('shareLink').value = fullLink;
      document.getElementById('linkArea').style.display = 'block';
      document.getElementById('statusBar').style.display = 'flex';
      document.getElementById('qualidadeBadge').innerText = `${resKey}p @ ${fpsVal}FPS`;
      
      document.getElementById('startBtn').style.display = 'none';
      document.getElementById('stopBtn').style.display = 'block';
      
      startTimer();
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const call = peer.call(conn.peer, localStream);
        if (call && call.peerConnection) {
          call.peerConnection.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'video') {
              const parameters = sender.getParameters();
              if (!parameters.encodings) parameters.encodings = [{}];
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
    alert("Erro ao iniciar transmissão: " + err.message);
  }
}
function parar() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }

  stopTimer();
  document.getElementById('preview').srcObject = null;
  document.getElementById('linkArea').style.display = 'none';
  document.getElementById('statusBar').style.display = 'none';
  document.getElementById('startBtn').style.display = 'block';
  document.getElementById('stopBtn').style.display = 'none';
}