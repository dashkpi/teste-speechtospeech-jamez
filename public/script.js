class OpenAIRealtimeClient {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.audioProcessor = null;
        this.audioQueue = [];
        this.isConnected = false;
        this.isMuted = false;
        this.isSpeakerMuted = false;
        this.micVolume = 0.8;
        this.speakerVolume = 0.8;
        this.sessionId = null;
        this.latencyStart = null;
        this.isPlaying = false;
        this.currentAudioSources = new Set();
        this.audioScheduler = null;
        
        // Elementos DOM
        this.elements = {};
        this.initializeElements();
        this.setupEventListeners();
        this.hideLoadingOverlay();
    }

    initializeElements() {
        const elementIds = [
            'connectBtn', 'disconnectBtn', 'muteBtn', 'speakerMuteBtn',
            'interruptBtn', 'clearLogBtn', 'micVolumeSlider', 'speakerVolumeSlider',
            'micVolumeValue', 'speakerVolumeValue', 'statusDot', 'statusText',
            'connectionPanel', 'audioPanel', 'conversationLog', 'loadingOverlay',
            'loadingText', 'errorModal', 'errorMessage', 'errorModalClose',
            'errorModalOk', 'micVisualizer', 'latencyInfo', 'sessionInfo',
            'modelInfo', 'audioQualityInfo', 'speakerStatus'
        ];

        elementIds.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    }

    setupEventListeners() {
        // Botões principais
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.elements.muteBtn.addEventListener('click', () => this.toggleMute());
        this.elements.speakerMuteBtn.addEventListener('click', () => this.toggleSpeakerMute());
        this.elements.interruptBtn.addEventListener('click', () => this.interruptAI());
        this.elements.clearLogBtn.addEventListener('click', () => this.clearLog());

        // Controles de volume
        this.elements.micVolumeSlider.addEventListener('input', (e) => {
            this.micVolume = e.target.value / 100;
            this.elements.micVolumeValue.textContent = e.target.value + '%';
        });

        this.elements.speakerVolumeSlider.addEventListener('input', (e) => {
            this.speakerVolume = e.target.value / 100;
            this.elements.speakerVolumeValue.textContent = e.target.value + '%';
        });

        // Modal de erro
        this.elements.errorModalClose.addEventListener('click', () => this.hideErrorModal());
        this.elements.errorModalOk.addEventListener('click', () => this.hideErrorModal());

        // Fechar modal clicando fora
        this.elements.errorModal.addEventListener('click', (e) => {
            if (e.target === this.elements.errorModal) {
                this.hideErrorModal();
            }
        });

        // Teclas de atalho
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.ctrlKey) {
                e.preventDefault();
                this.toggleMute();
            } else if (e.code === 'Escape') {
                if (this.isConnected) {
                    this.interruptAI();
                }
            }
        });
    }

    async connect() {
        try {
            this.showLoadingOverlay('Solicitando acesso ao microfone...');
            
            // Solicitar acesso ao microfone
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 24000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.updateLoadingText('Inicializando contexto de áudio...');
            
            // Inicializar contexto de áudio
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.updateLoadingText('Conectando com OpenAI...');
            
            // Conectar WebSocket
            await this.connectWebSocket();
            
            // Configurar processamento de áudio
            this.setupAudioProcessing();
            
            // Atualizar interface
            this.updateConnectionState(true);
            this.hideLoadingOverlay();
            
            this.logMessage('system', 'Conectado com sucesso! Você pode começar a falar.');

        } catch (error) {
            console.error('Erro ao conectar:', error);
            this.hideLoadingOverlay();
            this.showError('Erro ao conectar: ' + error.message);
            this.cleanup();
        }
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            
            this.ws = new WebSocket(wsUrl);
            
            const timeout = setTimeout(() => {
                reject(new Error('Timeout na conexão WebSocket'));
            }, 10000);

            this.ws.onopen = () => {
                clearTimeout(timeout);
                console.log('WebSocket conectado');
                resolve();
            };

            this.ws.onmessage = (event) => {
                this.handleWebSocketMessage(JSON.parse(event.data));
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket fechado:', event.code, event.reason);
                this.updateConnectionState(false);
                if (this.isConnected) {
                    this.showError('Conexão perdida com o servidor');
                }
            };

            this.ws.onerror = (error) => {
                clearTimeout(timeout);
                console.error('Erro no WebSocket:', error);
                reject(new Error('Erro na conexão WebSocket'));
            };
        });
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'connection_established':
                this.sessionId = message.sessionId;
                this.elements.sessionInfo.textContent = this.sessionId.substring(0, 8) + '...';
                this.logMessage('system', 'Sessão estabelecida: ' + message.message);
                break;

            case 'audio_delta':
                this.playAudioDelta(message.audio);
                break;

            case 'openai_event':
                this.handleOpenAIEvent(message.event);
                break;

            case 'connection_closed':
                this.logMessage('system', 'Conexão encerrada: ' + message.reason);
                this.updateConnectionState(false);
                break;

            case 'connection_error':
                this.showError('Erro de conexão: ' + message.message);
                break;

            case 'error':
                this.showError('Erro: ' + message.message);
                break;

            default:
                console.log('Mensagem não tratada:', message);
        }
    }

    handleOpenAIEvent(event) {
        switch (event.type) {
            case 'session.created':
                console.log('Sessão OpenAI criada:', event.session.id);
                break;

            case 'input_audio_buffer.speech_started':
                this.logMessage('user', 'Falando...');
                this.latencyStart = Date.now();
                // Parar áudio da IA quando usuário começa a falar (evitar sobreposição)
                this.stopAllAudio();
                break;

            case 'input_audio_buffer.speech_stopped':
                this.logMessage('system', 'Processando fala...');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (event.transcript) {
                    this.updateLastUserMessage(event.transcript);
                }
                break;

            case 'response.audio_transcript.delta':
                if (event.delta) {
                    this.appendAssistantMessage(event.delta);
                }
                break;

            case 'response.audio.done':
                if (this.latencyStart) {
                    const latency = Date.now() - this.latencyStart;
                    this.elements.latencyInfo.textContent = latency + ' ms';
                    this.latencyStart = null;
                }
                break;

            case 'error':
                console.error('Erro da OpenAI:', event.error);
                this.showError('Erro da OpenAI: ' + event.error.message);
                break;

            default:
                console.log('Evento OpenAI não tratado:', event.type);
        }
    }

    setupAudioProcessing() {
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        
        // Criar processador de áudio
        this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
        
        this.audioProcessor.onaudioprocess = (event) => {
            if (this.isMuted || !this.isConnected) return;

            const inputBuffer = event.inputBuffer;
            const inputData = inputBuffer.getChannelData(0);
            
            // Aplicar volume do microfone
            const processedData = new Float32Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                processedData[i] = inputData[i] * this.micVolume;
            }

            // Converter para PCM16
            const pcm16Data = this.floatToPCM16(processedData);
            
            // Enviar para o servidor
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'audio_data',
                    audio: this.arrayBufferToBase64(pcm16Data.buffer)
                }));
            }

            // Atualizar visualizador
            this.updateAudioVisualizer(inputData);
        };

        source.connect(this.audioProcessor);
        this.audioProcessor.connect(this.audioContext.destination);
    }

    floatToPCM16(float32Array) {
        const pcm16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Array[i]));
            pcm16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        return pcm16Array;
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async playAudioDelta(base64Audio) {
        if (this.isSpeakerMuted) return;

        try {
            const audioBuffer = this.base64ToArrayBuffer(base64Audio);
            const pcm16Array = new Int16Array(audioBuffer);
            
            // Converter PCM16 para Float32
            const float32Array = new Float32Array(pcm16Array.length);
            for (let i = 0; i < pcm16Array.length; i++) {
                float32Array[i] = pcm16Array[i] / (pcm16Array[i] < 0 ? 0x8000 : 0x7FFF);
            }

            // Criar buffer de áudio
            const audioContextBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000);
            audioContextBuffer.getChannelData(0).set(float32Array);

            // Criar source e aplicar volume
            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();
            
            source.buffer = audioContextBuffer;
            gainNode.gain.value = this.speakerVolume;
            
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Controle de sobreposição - rastrear fontes ativas
            this.currentAudioSources.add(source);
            this.isPlaying = true;
            this.updateSpeakerStatus();
            
            source.onended = () => {
                this.currentAudioSources.delete(source);
                if (this.currentAudioSources.size === 0) {
                    this.isPlaying = false;
                    this.updateSpeakerStatus();
                }
            };
            
            source.start();

        } catch (error) {
            console.error('Erro ao reproduzir áudio:', error);
        }
    }

    // Método para parar todo áudio atual (prevenir sobreposição)
    stopAllAudio() {
        this.currentAudioSources.forEach(source => {
            try {
                source.stop();
            } catch (error) {
                // Fonte já pode ter parado naturalmente
            }
        });
        this.currentAudioSources.clear();
        this.isPlaying = false;
        this.updateSpeakerStatus();
    }

    // Atualizar status do alto-falante
    updateSpeakerStatus() {
        if (this.elements.speakerStatus) {
            if (this.isPlaying) {
                this.elements.speakerStatus.textContent = '🔊 Reproduzindo';
                this.elements.speakerStatus.className = 'badge bg-success';
            } else {
                this.elements.speakerStatus.textContent = '🔇 Silencioso';
                this.elements.speakerStatus.className = 'badge bg-secondary';
            }
        }
    }

    updateAudioVisualizer(audioData) {
        // Calcular RMS (Root Mean Square) para o nível de áudio
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        const level = Math.min(1, rms * 10); // Amplificar para visualização

        // Atualizar barras do visualizador
        const bars = this.elements.micVisualizer.querySelectorAll('.visualizer-bar');
        bars.forEach((bar, index) => {
            const barLevel = Math.max(0, level - (index * 0.2));
            bar.style.height = (barLevel * 80 + 20) + '%';
            bar.classList.toggle('active', barLevel > 0.1);
        });
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        const btn = this.elements.muteBtn;
        const icon = btn.querySelector('i');
        const text = btn.querySelector('span');
        
        if (this.isMuted) {
            icon.className = 'fas fa-microphone-slash';
            text.textContent = 'Desativar';
            btn.classList.add('btn-warning');
            btn.classList.remove('btn-secondary');
        } else {
            icon.className = 'fas fa-microphone';
            text.textContent = 'Ativar';
            btn.classList.add('btn-secondary');
            btn.classList.remove('btn-warning');
        }
        
        this.logMessage('system', this.isMuted ? 'Microfone desativado' : 'Microfone ativado');
    }

    toggleSpeakerMute() {
        this.isSpeakerMuted = !this.isSpeakerMuted;
        const btn = this.elements.speakerMuteBtn;
        const icon = btn.querySelector('i');
        const text = btn.querySelector('span');
        
        if (this.isSpeakerMuted) {
            icon.className = 'fas fa-volume-mute';
            text.textContent = 'Desativar';
            btn.classList.add('btn-warning');
            btn.classList.remove('btn-secondary');
        } else {
            icon.className = 'fas fa-volume-up';
            text.textContent = 'Ativar';
            btn.classList.add('btn-secondary');
            btn.classList.remove('btn-warning');
        }
        
        this.logMessage('system', this.isSpeakerMuted ? 'Alto-falante desativado' : 'Alto-falante ativado');
    }

    interruptAI() {
        // Parar todo áudio em reprodução para evitar sobreposição
        this.stopAllAudio();
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'cancel_response'
            }));
            this.logMessage('system', 'Resposta da IA interrompida');
        }
    }

    disconnect() {
        this.cleanup();
        this.updateConnectionState(false);
        this.logMessage('system', 'Desconectado');
    }

    cleanup() {
        // Parar todo áudio em reprodução
        this.stopAllAudio();
        
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.sessionId = null;
        this.isPlaying = false;
        this.currentAudioSources.clear();
    }

    updateConnectionState(connected) {
        this.isConnected = connected;
        
        // Atualizar indicador de status
        const statusDot = this.elements.statusDot;
        const statusText = this.elements.statusText;
        
        if (connected) {
            statusDot.classList.add('connected');
            statusDot.classList.remove('connecting');
            statusText.textContent = 'Conectado';
            // Inicializar status do alto-falante
            this.updateSpeakerStatus();
        } else {
            statusDot.classList.remove('connected', 'connecting');
            statusText.textContent = 'Desconectado';
        }

        // Mostrar/ocultar painéis
        this.elements.connectionPanel.style.display = connected ? 'none' : 'block';
        this.elements.audioPanel.style.display = connected ? 'block' : 'none';

        // Resetar informações
        if (!connected) {
            this.elements.sessionInfo.textContent = '--';
            this.elements.latencyInfo.textContent = '-- ms';
        }
    }

    logMessage(type, content) {
        const log = this.elements.conversationLog;
        const messageDiv = document.createElement('div');
        messageDiv.className = `log-message ${type}`;
        
        const now = new Date();
        const timeString = now.toLocaleTimeString('pt-BR');
        
        let icon = 'fas fa-info-circle';
        let sender = 'Sistema';
        
        if (type === 'user') {
            icon = 'fas fa-user';
            sender = 'Você';
        } else if (type === 'assistant') {
            icon = 'fas fa-robot';
            sender = 'IA';
        }
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <i class="${icon}"></i>
                <span class="message-time">${sender} - ${timeString}</span>
            </div>
            <div class="message-content">${content}</div>
        `;
        
        log.appendChild(messageDiv);
        log.scrollTop = log.scrollHeight;
    }

    updateLastUserMessage(transcript) {
        const messages = this.elements.conversationLog.querySelectorAll('.log-message.user');
        const lastMessage = messages[messages.length - 1];
        
        if (lastMessage) {
            const content = lastMessage.querySelector('.message-content');
            content.textContent = transcript;
        }
    }

    appendAssistantMessage(delta) {
        const messages = this.elements.conversationLog.querySelectorAll('.log-message.assistant');
        let lastMessage = messages[messages.length - 1];
        
        if (!lastMessage || lastMessage.dataset.completed === 'true') {
            // Criar nova mensagem
            this.logMessage('assistant', delta);
            const newMessages = this.elements.conversationLog.querySelectorAll('.log-message.assistant');
            lastMessage = newMessages[newMessages.length - 1];
        } else {
            // Anexar ao conteúdo existente
            const content = lastMessage.querySelector('.message-content');
            content.textContent += delta;
        }
        
        this.elements.conversationLog.scrollTop = this.elements.conversationLog.scrollHeight;
    }

    clearLog() {
        this.elements.conversationLog.innerHTML = `
            <div class="log-message system">
                <div class="message-header">
                    <i class="fas fa-info-circle"></i>
                    <span class="message-time">Sistema</span>
                </div>
                <div class="message-content">
                    Log limpo. Continue conversando!
                </div>
            </div>
        `;
    }

    showLoadingOverlay(text = 'Carregando...') {
        this.elements.loadingText.textContent = text;
        this.elements.loadingOverlay.style.display = 'flex';
    }

    updateLoadingText(text) {
        this.elements.loadingText.textContent = text;
    }

    hideLoadingOverlay() {
        this.elements.loadingOverlay.style.display = 'none';
    }

    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.elements.errorModal.style.display = 'flex';
    }

    hideErrorModal() {
        this.elements.errorModal.style.display = 'none';
    }
}

// Verificar suporte do navegador
function checkBrowserSupport() {
    const requirements = [
        { feature: 'WebSocket', supported: 'WebSocket' in window },
        { feature: 'Web Audio API', supported: 'AudioContext' in window || 'webkitAudioContext' in window },
        { feature: 'getUserMedia', supported: navigator.mediaDevices && navigator.mediaDevices.getUserMedia },
        { feature: 'Base64', supported: 'btoa' in window && 'atob' in window }
    ];

    const unsupported = requirements.filter(req => !req.supported);
    
    if (unsupported.length > 0) {
        const features = unsupported.map(req => req.feature).join(', ');
        alert(`Seu navegador não suporta as seguintes funcionalidades necessárias: ${features}\n\nPor favor, use um navegador moderno como Chrome, Firefox ou Safari.`);
        return false;
    }
    
    return true;
}

// Inicializar aplicação
document.addEventListener('DOMContentLoaded', () => {
    if (checkBrowserSupport()) {
        window.realtimeClient = new OpenAIRealtimeClient();
        console.log('🎉 OpenAI Realtime Client inicializado com sucesso!');
        console.log('💡 Dicas:');
        console.log('   - Ctrl + Espaço: Alternar microfone');
        console.log('   - Esc: Interromper resposta da IA');
    }
});

// Tratar erros globais
window.addEventListener('error', (event) => {
    console.error('Erro global:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise rejeitada:', event.reason);
});

