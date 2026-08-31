# Live P2P — Transmissão de Tela em Tempo Real

Sistema de streaming de tela peer-to-peer (P2P) direto no navegador, sem necessidade de servidor de mídia, sem instalação e sem backend próprio. O transmissor captura a tela e compartilha um link; qualquer pessoa com o link assiste em tempo real.

---

## Objetivo

Permitir que uma pessoa transmita a tela do computador para uma ou mais pessoas através de um link simples, com baixa latência, qualidade configurável (até 4K/144fps) e sem depender de plataformas como YouTube, Twitch ou OBS. Tudo roda no navegador, usando WebRTC puro via PeerJS.

---

## Tecnologias

- **HTML5 + CSS3 + JavaScript puro** — sem frameworks, sem build tools
- **WebRTC** — protocolo de comunicação P2P nativo do navegador
- **PeerJS 1.5.2** (via CDN unpkg) — wrapper sobre WebRTC que simplifica a criação de conexões P2P e a sinalização
- **getDisplayMedia API** — captura a tela do transmissor
- **RTCPeerConnection.getStats()** — leitura de métricas de rede em tempo real
- **Clipboard API** — cópia do link do espectador
- **Google Fonts (Inter)** — tipografia na página do espectador

---

## Estrutura de Arquivos

```
live-p2p/
├── index.html          Painel do transmissor
├── espectador.html     Página do espectador
├── js/
│   ├── index.js        Lógica do transmissor
│   └── espectador.js   Lógica do espectador
└── css/
    ├── index.css       Estilos do painel do transmissor
    └── espectador.css  Estilos da página do espectador
```

---

## Arquitetura

### Visão geral do fluxo

```
[Transmissor]                    [Servidor PeerJS]               [Espectador]
     |                                  |                              |
     |-- Cria Peer com roomId --------->|                              |
     |<- Peer registrado (open) --------|                              |
     |                                  |<-- Espectador conecta -------|
     |<- conn (data channel) -----------|----------------------------->|
     |-- peer.call(conn.peer, stream) ->|----------------------------->|
     |                                  |         (negociação ICE)     |
     |<======== stream P2P direto (WebRTC) ========================>|
     |                                  |                              |
     |<-- conn.data (quality request) --|<-----------------------------|
     |-- setParameters(bitrate) ------->|                              |
```

A comunicação de mídia (vídeo + áudio) acontece **diretamente entre os pares** via WebRTC, sem passar pelo servidor PeerJS. O servidor PeerJS só é usado para **sinalização** (troca de SDP e candidatos ICE), que é necessária apenas no início da conexão.

O canal de dados (`DataConnection`) permanece aberto durante toda a transmissão e é usado para mensagens de controle, como os pedidos de ajuste de bitrate da qualidade adaptativa.

---

### Página do Transmissor (`index.html` + `js/index.js`)

**Responsabilidades:**
1. Capturar a tela com `getDisplayMedia`
2. Criar um `Peer` com ID aleatório (`live-XXXXXX`)
3. Gerar e exibir o link do espectador
4. Para cada espectador que conectar: iniciar uma `call` enviando o `localStream`
5. Aplicar bitrate inicial via `RTCRtpSender.setParameters()`
6. Escutar pedidos de ajuste de qualidade vindos dos espectadores
7. Gerenciar múltiplos espectadores simultaneamente com um `Map`

**Configurações disponíveis:**

| Resolução | Dimensões    |
|-----------|-------------|
| 720p HD   | 1280 × 720  |
| 1080p FHD | 1920 × 1080 |
| 1440p 2K  | 2560 × 1440 |
| 2160p 4K  | 3840 × 2160 |

| FPS | Bitrate aplicado         |
|-----|--------------------------|
| 30  | 12 Mbps                  |
| 60  | 12 Mbps                  |
| 120 | 30 Mbps                  |
| 144 | 30 Mbps                  |

Para 1440p ou 4K em qualquer FPS, o bitrate sobe automaticamente para 30 Mbps.

**Controle de múltiplos espectadores:**

Cada espectador que conecta gera uma entrada no `Map activeCalls` (`peerId → call`). Quando o espectador desconecta (via `call.on('close')` ou `conn.on('close')`), a entrada é removida e o contador é atualizado. Ao parar a transmissão, todas as calls são encerradas explicitamente antes de destruir o `Peer`.

---

### Página do Espectador (`espectador.html` + `js/espectador.js`)

**Responsabilidades:**
1. Ler o `roomId` da URL (`?room=live-XXXXXX`)
2. Validar o `roomId` antes de tentar conectar
3. Conectar ao transmissor via `DataConnection`
4. Receber a `call` de vídeo e exibir no player
5. Exibir métricas em tempo real (FPS, latência, timer)
6. Enviar pedidos de ajuste de bitrate ao transmissor quando a latência estiver alta
7. Reconectar automaticamente em caso de falha

**Fluxo de conexão:**

```
1. Valida roomId
2. Cria viewerPeer (sem ID fixo — PeerJS atribui um aleatório)
3. viewerPeer.connect(roomId) → abre DataConnection
4. Inicia timer de timeout de 15s
5. Transmissor recebe a conexão e faz peer.call(viewerId, stream)
6. viewerPeer.on('call') → call.answer()
7. call.on('stream') → exibe o vídeo, inicia métricas
```

---

### Métricas em tempo real

As métricas aparecem como overlay sobre o player e podem ser ocultadas pelo botão de toggle (ícone de gráfico, canto superior direito do player).

**FPS:**
Usa `requestVideoFrameCallback` quando disponível (Chrome 83+, Edge 83+), que conta frames individuais com precisão de milissegundo. Quando não disponível, usa `getVideoPlaybackQuality()` como fallback, lendo `totalVideoFrames` a cada segundo.

**Latência:**
Usa `RTCPeerConnection.getStats()` a cada segundo. Procura o relatório do tipo `candidate-pair` com `state === 'succeeded'` e lê `currentRoundTripTime` (em segundos), convertendo para milissegundos.

**Timer AO VIVO:**
Baseado em `Date.now()` — calcula `elapsed = Date.now() - watchStartTime` a cada segundo e formata em `HH:MM:SS`.

---

### Qualidade Adaptativa

O espectador monitora a latência e, quando ela se mantém alta por 3 amostras consecutivas, envia uma mensagem pelo canal de dados pedindo redução de bitrate. O transmissor aplica via `setParameters`.

**Níveis de bitrate:**

| Nível | Bitrate   | Condição de troca                          |
|-------|-----------|--------------------------------------------|
| Alta  | 12 Mbps   | Padrão inicial                             |
| Média | 4 Mbps    | 3 amostras consecutivas com latência > 200ms |
| Baixa | 1.5 Mbps  | 3 amostras consecutivas com latência > 200ms no nível médio |

Para subir de nível, são necessárias **6 amostras consecutivas** com latência < 80ms (exige mais estabilidade para subir do que para descer, evitando oscilação).

**Protocolo da mensagem:**
```js
// Espectador → Transmissor (via DataConnection)
conn.send({ type: 'quality', maxBitrate: 4000000 })

// Transmissor escuta:
conn.on('data', (data) => {
  if (data?.type === 'quality') aplicarBitrate(data.maxBitrate)
})
```

---

### Reconexão Automática

Se a conexão cair antes do stream chegar (ou durante tentativas de conexão), o espectador tenta reconectar automaticamente com **backoff exponencial**:

| Tentativa | Espera |
|-----------|--------|
| 1ª        | 2s     |
| 2ª        | 4s     |
| 3ª        | 8s     |
| 4ª        | 16s    |
| 5ª        | 32s    |

Após 5 tentativas sem sucesso, exibe mensagem de erro definitiva. Ao conectar com sucesso, o contador de tentativas é resetado.

---

## Como usar

### Transmitir

1. Abra `index.html` no navegador (requer servidor local — não funciona via `file://` por restrições de WebRTC)
2. Escolha a resolução e o FPS desejados
3. Clique em **Iniciar Transmissão**
4. Autorize o compartilhamento de tela no diálogo do navegador
5. Copie o link gerado e envie para quem quiser assistir

### Assistir

1. Abra o link recebido no navegador
2. A conexão é estabelecida automaticamente
3. O player exibe o stream com métricas de FPS e latência no canto superior esquerdo

### Servidor local recomendado

```bash
# Com Node.js
npx serve .

# Com Python
python -m http.server 5500

# Com VS Code
Extensão "Live Server" → botão "Go Live"
```

---

## Limitações conhecidas

**NAT simétrico:** WebRTC com STUN não consegue perfurar firewalls com NAT simétrico, comum em redes corporativas e universitárias. Redes residenciais normalmente funcionam sem problemas. Para suporte completo seria necessário um servidor TURN, o que está fora do escopo deste projeto.

**Servidor de sinalização público:** O PeerJS usa por padrão o servidor público `0.peerjs.com` para sinalização. Para uso em produção seria recomendável subir um servidor PeerJS próprio (`peer-server` no npm).

**Sem autenticação:** Qualquer pessoa com o link pode assistir a transmissão. Não há proteção por senha ou sistema de convite — isso exigiria um backend.

**Sem persistência:** Histórico de transmissões, gravação ou replay não estão disponíveis — também exigiriam backend.

---

## Bugs resolvidos

### Volume abaixando progressivamente durante a transmissão

**Causa:** O `getDisplayMedia` estava sendo chamado com `audio: true`, o que ativa os processamentos automáticos de áudio do WebRTC: `autoGainControl`, `noiseSuppression` e `echoCancellation`. O AGC (Automatic Gain Control) foi projetado para microfone e fica ajustando o ganho continuamente, fazendo o volume do áudio de sistema cair ao longo do tempo.

**Solução:** Substituir `audio: true` por um objeto com os três processamentos explicitamente desabilitados:
```js
audio: {
  autoGainControl:  false,
  noiseSuppression: false,
  echoCancellation: false
}
```

---

### Métricas não apareciam sobre o vídeo

**Causa:** Os elementos de métricas estavam dentro do `div.video-container`, que contém o `<video controls>`. Os controles nativos do navegador criam uma camada de shadow DOM que fica acima de qualquer elemento com `z-index` dentro do mesmo container, ignorando completamente o stacking context do CSS.

**Solução:** Mover os elementos de métricas e o botão toggle para fora do `video-container`, posicionando-os como filhos diretos do `video-card`. O `video-card` recebeu `position: relative` para servir de âncora para o posicionamento absoluto dos overlays.

---

### Referência `conn` inacessível no handler da call

**Causa:** O objeto `conn` (DataConnection) era criado com `const` dentro do callback `viewerPeer.on('open', ...)`. O handler `viewerPeer.on('call', ...)` ficava em um escopo paralelo e não tinha acesso ao `conn`, fazendo com que `showMetrics(call, conn)` recebesse `undefined` como segundo argumento. A qualidade adaptativa nunca conseguia enviar mensagens ao transmissor.

**Solução:** Declarar `conn` com `let` no escopo da função `conectar()`, tornando-o acessível tanto no handler de `open` quanto no handler de `call`:
```js
function conectar() {
  let conn = null;           // escopo compartilhado
  viewerPeer.on('open', () => {
    conn = viewerPeer.connect(roomId);  // atribuição
  });
  viewerPeer.on('call', (call) => {
    // conn está acessível aqui via closure
    showMetrics(call, conn);
  });
}
```

---

### `setParameters` de bitrate falhava silenciosamente

**Causa:** O `setParameters` era chamado logo após a criação da call, dentro do `conn.on('open')`. Nesse momento, o `RTCPeerConnection` ainda estava negociando os candidatos ICE e o `RTCRtpSender` não estava pronto para receber parâmetros de encoding. A chamada falhava sem lançar exceção visível.

**Solução:** Aguardar o evento `iceconnectionstatechange` e só aplicar o bitrate quando o estado for `'connected'`:
```js
call.peerConnection.addEventListener('iceconnectionstatechange', () => {
  if (call.peerConnection.iceConnectionState === 'connected') {
    aplicarBitrate(bitrateInicial);
  }
});
```

---

### Botão "Copiar link" sem feedback e sem tratamento de erro

**Causa:** `navigator.clipboard.writeText()` retorna uma Promise, mas o código original não usava `.then()` nem `.catch()`. O `alert("Link copiado!")` disparava imediatamente, antes mesmo da cópia ser concluída — e mesmo quando ela falhava (ex: contexto não seguro, permissão negada).

**Solução:** Encadear `.then()` para feedback de sucesso e `.catch()` com fallback via `document.execCommand('copy')`. O feedback passou a ser visual (texto e cor do botão) em vez de `alert()`:
```js
navigator.clipboard.writeText(input.value)
  .then(() => { /* mostra ✓ Copiado */ })
  .catch(() => {
    document.execCommand('copy'); // fallback
    /* ou mostra ✗ Falhou */
  });
```

---

### Sem cleanup ao fechar conexão de dados no espectador

**Causa:** O código original não tinha handler para `conn.on('close')`. Se a `DataConnection` fechasse inesperadamente (ex: transmissor reiniciando), o espectador ficava em estado indefinido — sem mensagem de erro, sem tentativa de reconexão.

**Solução:** Adicionar `conn.on('close', ...)` que chama `tentarReconectar()` quando o stream ainda não foi recebido, garantindo cleanup e nova tentativa de conexão.

---

### Espectador ficava preso esperando para sempre

**Causa:** Não havia nenhum timeout caso o `roomId` fosse válido mas o transmissor não existisse ou estivesse offline. O espectador ficava indefinidamente em "Procurando transmissor...".

**Solução:** Implementar um `setTimeout` de 15 segundos que, se o stream não chegar, exibe "Transmissão não encontrada ou transmissor offline." e encerra a tentativa.

---

### Sem validação do `roomId` da URL

**Causa:** O parâmetro `room` da URL era usado diretamente sem nenhuma validação. Qualquer string, incluindo valores maliciosos, era passada ao PeerJS.

**Solução:** Validar com regex antes de usar:
```js
function isValidRoomId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{3,64}$/.test(id);
}
```
Strings inválidas exibem "Link de transmissão inválido." imediatamente, sem tentar conectar.

---

## Funcionalidades adicionadas

- **Contador de espectadores** — exibe `👥 N` na barra de status do transmissor, atualizado em tempo real conforme espectadores entram e saem
- **Suporte a múltiplos espectadores simultâneos** — gerenciado com `Map<peerId, call>`, com cleanup correto no disconnect
- **Qualidade adaptativa** — bitrate ajustado automaticamente baseado na latência medida pelo espectador
- **Reconexão automática** — backoff exponencial com até 5 tentativas no espectador
- **Timeout de conexão** — 15 segundos antes de exibir erro de transmissão não encontrada
- **Feedback visual no botão copiar** — ✓ Copiado em verde / ✗ Falhou em vermelho, sem `alert()`
