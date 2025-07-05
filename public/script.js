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
        this.audioQueue = [];
        this.nextStartTime = 0;
        this.isProcessingQueue = false;
        
        // Analytics tracking
        this.sessionStartTime = null;
        this.analyticsInterval = null;
        this.lastAnalyticsUpdate = 0;
        
        // Voice settings
        this.voiceSettings = {
            voice: 'echo',
            temperature: 0.8,
            max_response_output_tokens: 4096,
            turn_detection: {
                type: 'server_vad',
                threshold: 0.6,
                prefix_padding_ms: 200,
                silence_duration_ms: 500
            },
            custom_instructions: ''
        };
        
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
            'modelInfo', 'audioQualityInfo', 'speakerStatus',
            // Novos elementos para analytics
            'refreshAnalyticsBtn', 'sessionDuration', 'sessionCost', 'audioInputDuration',
            'audioOutputDuration', 'inputTokensInfo', 'outputTokensInfo',
            'transcriptionsContainer', 'recordingsContainer', 'downloadTranscriptionsBtn',
            'clearTranscriptionsBtn', 'exportRecordingsBtn',
            // Elementos para configurações de voz
            'toggleVoiceSettingsBtn', 'voiceSettingsPanel', 'voiceModelSelect',
            'temperatureSlider', 'temperatureValue', 'maxTokensSlider', 'maxTokensValue',
            'vadThresholdSlider', 'vadThresholdValue', 'silenceDurationSlider', 'silenceDurationValue',
            'customInstructions', 'applyVoiceSettingsBtn', 'testVoiceBtn', 'resetVoiceBtn'
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

        // Novos botões de analytics
        this.elements.refreshAnalyticsBtn?.addEventListener('click', () => this.refreshAnalytics());
        this.elements.downloadTranscriptionsBtn?.addEventListener('click', () => this.downloadTranscriptions());
        this.elements.clearTranscriptionsBtn?.addEventListener('click', () => this.clearTranscriptions());
        this.elements.exportRecordingsBtn?.addEventListener('click', () => this.exportRecordings());

        // Configurações de voz
        this.elements.toggleVoiceSettingsBtn?.addEventListener('click', () => this.toggleVoiceSettings());
        this.elements.applyVoiceSettingsBtn?.addEventListener('click', () => this.applyVoiceSettings());
        this.elements.testVoiceBtn?.addEventListener('click', () => this.testVoice());
        this.elements.resetVoiceBtn?.addEventListener('click', () => this.resetVoiceSettings());

        // Sliders de configuração de voz
        this.elements.temperatureSlider?.addEventListener('input', (e) => {
            this.elements.temperatureValue.textContent = e.target.value;
        });

        this.elements.maxTokensSlider?.addEventListener('input', (e) => {
            this.elements.maxTokensValue.textContent = e.target.value;
        });

        this.elements.vadThresholdSlider?.addEventListener('input', (e) => {
            this.elements.vadThresholdValue.textContent = e.target.value;
        });

        this.elements.silenceDurationSlider?.addEventListener('input', (e) => {
            this.elements.silenceDurationValue.textContent = e.target.value + 'ms';
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
            
            // Iniciar analytics
            this.sessionStartTime = new Date();
            this.startAnalyticsTracking();
            
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
                
                // Enviar configuração inicial da sessão com configurações de voz
                this.sendInitialSessionConfig();
                
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
                    // Atualizar transcrições em tempo real
                    setTimeout(() => this.loadTranscriptions(), 500);
                }
                break;

            case 'response.audio_transcript.delta':
                if (event.delta) {
                    this.appendAssistantMessage(event.delta);
                }
                break;

            case 'response.audio_transcript.done':
                // Atualizar transcrições quando a resposta estiver completa
                setTimeout(() => this.loadTranscriptions(), 500);
                break;

            case 'response.audio.delta':
                // IGNORAR - áudio já é tratado via audio_delta do servidor
                // Isso previne duplicação de áudio
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
        // Conectar ao destination apenas para processamento, mas sem volume
        // Isso permite que o audioProcessor funcione sem reproduzir o áudio do microfone
        const silentGain = this.audioContext.createGain();
        silentGain.gain.value = 0; // Volume zero para evitar eco
        this.audioProcessor.connect(silentGain);
        silentGain.connect(this.audioContext.destination);
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

            // Adicionar à fila para reprodução sequencial
            this.queueAudioBuffer(audioContextBuffer);

        } catch (error) {
            console.error('Erro ao processar áudio:', error);
        }
    }

    queueAudioBuffer(audioBuffer) {
        // Calcular quando este áudio deve começar
        const currentTime = this.audioContext.currentTime;
        const startTime = Math.max(currentTime, this.nextStartTime);
        
        // Criar source e aplicar volume
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        
        source.buffer = audioBuffer;
        gainNode.gain.value = this.speakerVolume;
        
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        // Controle de fontes ativas
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
        
        // Agendar reprodução no tempo correto
        source.start(startTime);
        
        // Atualizar próximo tempo de início
        this.nextStartTime = startTime + audioBuffer.duration;
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
        
        // Resetar fila de áudio para nova sequência
        this.nextStartTime = 0;
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
        this.stopAnalyticsTracking();
        this.cleanup();
        this.updateConnectionState(false);
        this.logMessage('system', 'Desconectado');
    }

    cleanup() {
        // Parar todo áudio em reprodução
        this.stopAllAudio();
        
        // Parar analytics tracking
        this.stopAnalyticsTracking();
        
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
        this.nextStartTime = 0;
        this.sessionStartTime = null;
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
    // ========== ANALYTICS E VISUALIZAÇÃO DE DADOS ==========

    startAnalyticsTracking() {
        // Atualizar analytics a cada 2 segundos
        this.analyticsInterval = setInterval(() => {
            this.updateAnalytics();
        }, 2000);
        
        // Atualização inicial
        this.updateAnalytics();
    }

    stopAnalyticsTracking() {
        if (this.analyticsInterval) {
            clearInterval(this.analyticsInterval);
            this.analyticsInterval = null;
        }
    }

    async updateAnalytics() {
        if (!this.sessionId) return;

        try {
            const response = await fetch(`/api/session/${this.sessionId}`);
            if (response.ok) {
                const data = await response.json();
                this.displayAnalytics(data);
            }
        } catch (error) {
            console.error('Erro ao atualizar analytics:', error);
        }
    }

    displayAnalytics(data) {
        // Duração da sessão
        if (this.elements.sessionDuration) {
            const duration = this.formatDuration(data.duration);
            this.elements.sessionDuration.textContent = duration;
            this.elements.sessionDuration.classList.add('updating');
            setTimeout(() => this.elements.sessionDuration.classList.remove('updating'), 300);
        }

        // Custo total
        if (this.elements.sessionCost) {
            const cost = `$${data.totalCost.toFixed(6)}`;
            this.elements.sessionCost.textContent = cost;
            this.elements.sessionCost.classList.add('updating');
            setTimeout(() => this.elements.sessionCost.classList.remove('updating'), 300);
        }

        // Duração de áudio
        if (this.elements.audioInputDuration) {
            this.elements.audioInputDuration.textContent = `${data.audioInputDuration.toFixed(1)}s`;
        }
        
        if (this.elements.audioOutputDuration) {
            this.elements.audioOutputDuration.textContent = `${data.audioOutputDuration.toFixed(1)}s`;
        }

        // Tokens
        if (this.elements.inputTokensInfo) {
            this.elements.inputTokensInfo.textContent = data.inputTokens.toString();
        }
        
        if (this.elements.outputTokensInfo) {
            this.elements.outputTokensInfo.textContent = data.outputTokens.toString();
        }
    }

    async refreshAnalytics() {
        if (!this.sessionId) return;

        try {
            // Mostrar loading no botão
            const btn = this.elements.refreshAnalyticsBtn;
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
            btn.disabled = true;

            // Atualizar todos os dados
            await Promise.all([
                this.updateAnalytics(),
                this.loadTranscriptions(),
                this.loadRecordings()
            ]);

            // Restaurar botão
            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }, 1000);

        } catch (error) {
            console.error('Erro ao atualizar dados:', error);
            this.showError('Erro ao atualizar dados da sessão');
        }
    }

    async loadTranscriptions() {
        if (!this.sessionId) return;

        try {
            const response = await fetch(`/api/session/${this.sessionId}/transcriptions`);
            if (response.ok) {
                const data = await response.json();
                this.displayTranscriptions(data.transcriptions);
            }
        } catch (error) {
            console.error('Erro ao carregar transcrições:', error);
        }
    }

    displayTranscriptions(transcriptions) {
        const container = this.elements.transcriptionsContainer;
        if (!container) return;

        if (transcriptions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <p>Nenhuma transcrição disponível ainda.</p>
                    <small>As transcrições aparecerão aqui conforme você conversa.</small>
                </div>
            `;
            return;
        }

        container.innerHTML = transcriptions.map(transcription => `
            <div class="transcription-item ${transcription.type}">
                <div class="transcription-meta">
                    <div class="transcription-type ${transcription.type}">
                        <i class="fas fa-${transcription.type === 'user' ? 'user' : 'robot'}"></i>
                        ${transcription.type === 'user' ? 'Você' : 'IA'}
                    </div>
                    <div class="transcription-time">
                        ${new Date(transcription.timestamp).toLocaleTimeString('pt-BR')}
                    </div>
                </div>
                <div class="transcription-text">
                    ${transcription.text}
                </div>
            </div>
        `).join('');
    }

    async loadRecordings() {
        if (!this.sessionId) return;

        try {
            const response = await fetch(`/api/session/${this.sessionId}/recordings`);
            if (response.ok) {
                const data = await response.json();
                this.displayRecordings(data.recordings);
            }
        } catch (error) {
            console.error('Erro ao carregar gravações:', error);
        }
    }

    displayRecordings(recordings) {
        const container = this.elements.recordingsContainer;
        if (!container) return;

        if (recordings.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-record-vinyl"></i>
                    <p>Nenhuma gravação disponível ainda.</p>
                    <small>As gravações aparecerão aqui conforme você conversa.</small>
                </div>
            `;
            return;
        }

        container.innerHTML = recordings.map((recording, index) => `
            <div class="recording-item ${recording.type}">
                <div class="recording-icon ${recording.type}">
                    <i class="fas fa-${recording.type === 'user' ? 'microphone' : 'volume-up'}"></i>
                </div>
                <div class="recording-info">
                    <div class="recording-title">
                        ${recording.type === 'user' ? 'Gravação do Usuário' : 'Resposta da IA'} #${index + 1}
                    </div>
                    <div class="recording-details">
                        ${new Date(recording.timestamp).toLocaleTimeString('pt-BR')} • 
                        ${recording.duration.toFixed(1)}s • 
    // ========== CONFIGURAÇÕES DE VOZ ==========

    toggleVoiceSettings() {
        const panel = this.elements.voiceSettingsPanel;
        const btn = this.elements.toggleVoiceSettingsBtn;
        
        if (panel.style.display === 'none' || !panel.style.display) {
            panel.style.display = 'block';
            btn.innerHTML = '<i class="fas fa-cog"></i> Ocultar Configurações';
            btn.classList.add('btn-warning');
            btn.classList.remove('btn-secondary');
        } else {
            panel.style.display = 'none';
            btn.innerHTML = '<i class="fas fa-cog"></i> Configurações de Voz';
            btn.classList.add('btn-secondary');
            btn.classList.remove('btn-warning');
        }
    }

    applyVoiceSettings() {
        if (!this.isConnected) {
            this.showError('Conecte-se primeiro para aplicar as configurações de voz');
            return;
        }

        try {
            // Coletar configurações da interface
            this.voiceSettings.voice = this.elements.voiceModelSelect?.value || 'echo';
            this.voiceSettings.temperature = parseFloat(this.elements.temperatureSlider?.value || '0.8');
            this.voiceSettings.max_response_output_tokens = parseInt(this.elements.maxTokensSlider?.value || '4096');
            
            this.voiceSettings.turn_detection.threshold = parseFloat(this.elements.vadThresholdSlider?.value || '0.6');
            this.voiceSettings.turn_detection.silence_duration_ms = parseInt(this.elements.silenceDurationSlider?.value || '500');
            
            this.voiceSettings.custom_instructions = this.elements.customInstructions?.value || '';

            // Construir instruções completas
            const baseInstructions = "Você é Jamez, o assistente virtual oficial da plataforma RealsBet e do Game Show Teleshow. " +
                "Seu papel é ser um guia interativo, transparente e divertido, ajudando o usuário a tomar decisões mais conscientes nos jogos. " +
                "Sempre trate o usuário de forma amigável e personalizada. " +
                "RealsBet é entretenimento com estratégia. Proibido para menores de 18 anos. Jogue com responsabilidade.";

            const finalInstructions = this.voiceSettings.custom_instructions 
                ? baseInstructions + "\n\nInstruções Personalizadas: " + this.voiceSettings.custom_instructions
                : baseInstructions;

            // Enviar nova configuração para OpenAI
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'update_session',
                    session: {
                        modalities: ['text', 'audio'],
                        instructions: finalInstructions,
                        voice: this.voiceSettings.voice,
                        input_audio_format: 'pcm16',
                        output_audio_format: 'pcm16',
                        input_audio_transcription: {
                            model: 'whisper-1'
                        },
                        turn_detection: this.voiceSettings.turn_detection,
                        tools: [],
                        tool_choice: 'auto',
                        temperature: this.voiceSettings.temperature,
                        max_response_output_tokens: this.voiceSettings.max_response_output_tokens
                    }
                }));

                this.logMessage('system', 'Configurações de voz aplicadas com sucesso!');
                
                // Mostrar feedback visual
                const btn = this.elements.applyVoiceSettingsBtn;
                const originalContent = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Aplicado!';
                btn.classList.add('btn-success');
                btn.classList.remove('btn-primary');
                
                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.classList.add('btn-primary');
                    btn.classList.remove('btn-success');
                }, 2000);
            }

        } catch (error) {
            console.error('Erro ao aplicar configurações de voz:', error);
            this.showError('Erro ao aplicar configurações de voz: ' + error.message);
        }
    }

    testVoice() {
        if (!this.isConnected) {
            this.showError('Conecte-se primeiro para testar a voz');
            return;
        }

        // Aplicar configurações primeiro
        this.applyVoiceSettings();

        // Aguardar um pouco e então enviar uma mensagem de teste
        setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'test_voice',
                    message: 'Olá! Esta é uma mensagem de teste para verificar as configurações de voz. Como você está hoje?'
                }));
                
                this.logMessage('system', 'Teste de voz enviado. Aguarde a resposta...');
            }
        }, 1000);
    }

    resetVoiceSettings() {
        // Resetar para valores padrão
        this.voiceSettings = {
            voice: 'echo',
            temperature: 0.8,
            max_response_output_tokens: 4096,
            turn_detection: {
                type: 'server_vad',
                threshold: 0.6,
                prefix_padding_ms: 200,
                silence_duration_ms: 500
            },
            custom_instructions: ''
        };

        // Atualizar interface
        if (this.elements.voiceModelSelect) this.elements.voiceModelSelect.value = 'echo';
        if (this.elements.temperatureSlider) {
            this.elements.temperatureSlider.value = '0.8';
            this.elements.temperatureValue.textContent = '0.8';
        }
        if (this.elements.maxTokensSlider) {
            this.elements.maxTokensSlider.value = '4096';
            this.elements.maxTokensValue.textContent = '4096';
        }
        if (this.elements.vadThresholdSlider) {
            this.elements.vadThresholdSlider.value = '0.6';
            this.elements.vadThresholdValue.textContent = '0.6';
        }
        if (this.elements.silenceDurationSlider) {
            this.elements.silenceDurationSlider.value = '500';
            this.elements.silenceDurationValue.textContent = '500ms';
        }
        if (this.elements.customInstructions) {
            this.elements.customInstructions.value = '';
        }

        this.logMessage('system', 'Configurações de voz resetadas para os valores padrão');

        // Aplicar automaticamente se conectado
        if (this.isConnected) {
            setTimeout(() => this.applyVoiceSettings(), 500);
        }
    }

                        ${this.formatBytes(recording.size)}
                    </div>
                </div>
                <div class="recording-actions">
                    <button class="btn btn-small btn-secondary" onclick="realtimeClient.downloadRecording(${index})">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    async downloadTranscriptions() {
        if (!this.sessionId) return;

        try {
            const response = await fetch(`/api/session/${this.sessionId}/transcriptions`);
            if (response.ok) {
                const data = await response.json();
                
                const content = data.transcriptions.map(t => 
                    `[${new Date(t.timestamp).toLocaleString('pt-BR')}] ${t.type === 'user' ? 'Você' : 'IA'}: ${t.text}`
                ).join('\n\n');

                this.downloadFile(
                    `transcricoes-${this.sessionId.substring(0, 8)}.txt`,
                    content,
                    'text/plain'
                );
            }
        } catch (error) {
            console.error('Erro ao baixar transcrições:', error);
            this.showError('Erro ao baixar transcrições');
        }
    }

    clearTranscriptions() {
        const container = this.elements.transcriptionsContainer;
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <p>Transcrições limpas.</p>
                    <small>Novas transcrições aparecerão aqui conforme você conversa.</small>
                </div>
            `;
        }
    }

    async exportRecordings() {
        if (!this.sessionId) return;

        try {
            const response = await fetch(`/api/session/${this.sessionId}/recordings`);
            if (response.ok) {
                const data = await response.json();
                
                const exportData = {
                    sessionId: this.sessionId,
                    exportDate: new Date().toISOString(),
                    totalRecordings: data.count,
                    totalInputDuration: data.totalInputDuration,
                    totalOutputDuration: data.totalOutputDuration,
                    recordings: data.recordings.map(r => ({
                        type: r.type,
                        timestamp: r.timestamp,
                        duration: r.duration,
                        size: r.size
                    }))
                };

                this.downloadFile(
                    `gravacoes-${this.sessionId.substring(0, 8)}.json`,
                    JSON.stringify(exportData, null, 2),
                    'application/json'
                );
            }
        } catch (error) {
            console.error('Erro ao exportar gravações:', error);
            this.showError('Erro ao exportar gravações');
        }
    }

    downloadRecording(index) {
        // Esta funcionalidade requereria armazenar os dados de áudio completos
        // Por enquanto, apenas mostra uma mensagem informativa
        this.showError('Download de gravações individuais não implementado ainda. Use a exportação de dados.');
    }

    // Utilitários
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    sendInitialSessionConfig() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Construir instruções base
            const baseInstructions = "Você é Jamez, o assistente virtual oficial da plataforma RealsBet e do Game Show Teleshow. " +
                "Seu papel é ser um guia interativo, transparente e divertido, ajudando o usuário a tomar decisões mais conscientes nos jogos. " +
                "Sempre trate o usuário de forma amigável e personalizada. " +
                "RealsBet é entretenimento com estratégia. Proibido para menores de 18 anos. Jogue com responsabilidade.";

            const finalInstructions = this.voiceSettings.custom_instructions
                ? baseInstructions + "\n\nInstruções Personalizadas: " + this.voiceSettings.custom_instructions
                : baseInstructions;

            // Enviar configuração inicial da sessão
            this.ws.send(JSON.stringify({
                type: 'session_config',
                config: {
                    modalities: ['text', 'audio'],
                    instructions: finalInstructions,
                    voice: this.voiceSettings.voice,
                    input_audio_format: 'pcm16',
                    output_audio_format: 'pcm16',
                    input_audio_transcription: {
                        model: 'whisper-1'
                    },
                    turn_detection: this.voiceSettings.turn_detection,
                    tools: [],
                    tool_choice: 'auto',
                    temperature: this.voiceSettings.temperature,
                    max_response_output_tokens: this.voiceSettings.max_response_output_tokens
                }
            }));
            
            console.log('Configuração inicial da sessão enviada');
        }
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

