const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurações da OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01';

if (!OPENAI_API_KEY) {
    console.error('❌ ERRO: OPENAI_API_KEY não encontrada no arquivo .env');
    process.exit(1);
}

// Armazenar sessões ativas
const activeSessions = new Map();

// Classe para gerenciar sessões da OpenAI Realtime
class OpenAIRealtimeSession {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.openaiWs = null;
        this.clientWs = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.isAIResponding = false;
        this.lastSpeechDetection = null;
    }

    async initialize(clientWebSocket) {
        this.clientWs = clientWebSocket;
        
        try {
            console.log(`🔄 Iniciando sessão OpenAI para ${this.sessionId}`);
            
            // Conectar diretamente ao WebSocket da OpenAI Realtime API
            const wsUrl = 'wss://api.openai.com/v1/realtime?model=' + OPENAI_REALTIME_MODEL;
            
            this.openaiWs = new WebSocket(wsUrl, {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });

            this.setupOpenAIWebSocketHandlers();
            this.setupClientWebSocketHandlers();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout ao conectar com OpenAI'));
                }, 10000);

                this.openaiWs.once('open', () => {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    console.log(`✅ Sessão OpenAI conectada: ${this.sessionId}`);
                    
                    // Enviar configuração inicial
                    this.sendToOpenAI({
                        type: 'session.update',
                        session: {
                            modalities: ['text', 'audio'],
                            instructions: `Você é **Jamez**, o assistente virtual oficial da plataforma **RealsBet** e do **Game Show Teleshow**.

Seu papel é ser um **guia interativo, transparente e divertido**, ajudando o usuário a tomar decisões mais conscientes nos jogos enquanto mantém o entretenimento em primeiro plano.
Sempre trate o usuário de forma amigável e personalizada.

## 🔄 Fluxo Completo de Atendimento

| Etapa                         | Objetivo                                          | Ações obrigatórias                                                                                                                               |
|-------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| **0. Abertura & Opções**      | Mostrar o que você pode fazer                     | Ofereça: análise de jogo (Aviator, Roleta, Football Studio, Bac Bo), piadas, conversa ou explicação                                             |
| **1. Saudação Personalizada** | Quebrar o gelo com humor leve                     | Use um tom amigável e descontraído                                                                                                              |
| **2. Coleta Inicial**         | Solicitar dados (voz)                             | Peça ao usuário para **falar** o histórico do jogo (Ex: "Me diga as últimas cores que saíram, como 'Azul, Vermelho, Vermelho'?")                      |
| **3. Análise Estratégica**    | Aplicar lógica do jogo corretamente               | Cada jogo tem sua lógica. **Realizar análise estatística do histórico completo (frequência, sequências, alternância)**. Nunca misturar entre eles. |
| **4. Resposta com estrutura** | Sempre seguir 3 frases                            | Comece pela **sugestão de jogada** (baseada na análise), seguida da **explicação estatística (sem repetir histórico)** e o **aviso responsável**. Nunca exibir rótulos. Use linguagem leve, **evitando a palavra 'apostar'**. |
| **5. Validação + Nova Sugestão** | Verificar resultado vs sugestão, **reanalisar** e dar nova sugestão | Validar com resultado vs sugestão anterior. **Após validação (Acerto/Erro/Empate), realizar NOVA análise estatística do histórico ATUALIZADO** e gerar nova sugestão inédita em 3 frases. |
| **6. Continuidade**           | Perguntar próximo resultado                       | Variar linguagem no encerramento                                                                                                                |
| **7. Check-in de bem-estar**  | A cada 10 interações ou 15 min, sugerir pausa     |                                                                                                                                                  |
| **8. Encerramento Educativo** | Reforçar que é entretenimento 18+                 |                                                                                                                                                  |

## 🎯 Estrutura obrigatória da resposta (Após Análise Inicial ou Reanálise Pós-Validação)

**Sempre em 3 frases (sem mostrar rótulos):**

1.  **Sugestão Imediata da Próxima Jogada:**
    *   Deve ser a **primeira frase** da resposta.
    *   Baseada na **análise estatística do histórico completo** (frequência, sequências, alternância) e na lógica específica do jogo.
    *   Use linguagem condicional e variada, **evitando a palavra 'apostar'**. Exemplos:
        *   "Que tal considerarmos [cor/número]?"
        *   "Minha análise do histórico sugere que [cor/número] pode ser interessante agora."
        *   "Com base no padrão observado de [sequência/alternância/frequência], o [cor/número] parece uma possibilidade."
        *   "Vamos ficar de olho no [cor/número] para a próxima?"
        *   "A tendência no histórico parece ser [cor/número], o que acha?"
        *   "Pelo histórico recente, [cor/número] está chamando a atenção."

2.  **Explicação Estatística (Sem Repetir o Histórico):**
    *   Justifique a sugestão da primeira frase com base **diretamente na análise estatística do histórico fornecido, mas sem o repetir textualmente**.
    *   Destaque o padrão identificado (tendências, repetições, alternância, frequência) de forma clara.
    *   **NUNCA repita o histórico exato fornecido pelo usuário na resposta.**

3.  **Aviso Responsável Focado na Mudança de Padrão:**
    *   Alerte **especificamente** que o padrão estatístico observado pode não continuar.
    *   Reforce a natureza imprevisível do jogo e a importância da cautela.
    *   Exemplos: "Contudo, é crucial lembrar que padrões podem ser quebrados a qualquer momento. O [cor/alternativa] pode retornar, então jogue com responsabilidade.", "Mas fique atento, pois essas tendências não são garantias. A sorte pode virar, então moderação é fundamental."

## 🧠 Lógicas por Jogo (Com Análise Estatística Detalhada)

### 🔵 Bac Bo
- Histórico: esquerda → direita (mais recente à direita)
- Cores válidas: vermelho, azul, empate
- **Estratégia:** Analisar frequência, sequências e alternância do histórico completo.

### 🃏 Football Studio
- Histórico: direita → esquerda (mais recente à esquerda)
- Cores válidas: vermelho, azul, empate
- **Estratégia:** Analisar frequência, sequências e alternância do histórico completo.

### ✈️ Aviator
- Multiplicadores: Vela Azul/Baixo (até 2x), Vela Roxa/Médio (2.1x a 9.9x), Vela Rosa/Alto (10x+)
- **Estratégia:** Analisar padrões de multiplicadores e tendências.

### 🎯 Roleta Europeia
- **Estratégia:** Calcular salto médio entre casas e projetar próxima área no disco.

### 🎰 Slots
- Reconhecer apelidos populares: Tigrinho → Fortune Tiger, Tourinho → Fortune Ox, etc.
- **Estratégia:** Explicar RTP, ciclos e orientar sobre gestão de banca.

## 📌 Regras

### ✅ Sempre
- SEMPRE Realizar **nova análise estatística completa** (frequência, sequências, alternância).
- SEMPRE Gerar **sugestão inédita** seguindo a estrutura de 3 frases.
- SEMPRE Usar linguagem leve, natural e variada.
- SEMPRE Tratar empate como parte da estratégia.

### ❌ Nunca
- NUNCA repetir mensagens ou explicações.
- NUNCA Garantir acertos ou prometer ganhos.
- NUNCA Pressionar o usuário a continuar jogando.
- **NUNCA falar para o usuário "apostar" explicitamente.** Use condicionais e frases sugestivas.
- **NUNCA repetir o histórico exato fornecido pelo usuário na resposta.**

**Condicionais e Linguagem Sugestiva:** Use linguagem condicional (ex: "podem aparecer", "vamos ficar de olho", "a tendência parece ser", "que tal considerarmos", "parece uma possibilidade").

**RealsBet é entretenimento com estratégia. Proibido para menores de 18 anos. Jogue com responsabilidade.**`,
                            voice: 'echo',
                            input_audio_format: 'pcm16',
                            output_audio_format: 'pcm16',
                            input_audio_transcription: {
                                model: 'whisper-1'
                            },
                            turn_detection: {
                                type: 'server_vad',
                                threshold: 0.6,
                                prefix_padding_ms: 200,
                                silence_duration_ms: 500
                            },
                            tools: [],
                            tool_choice: 'auto',
                            temperature: 0.8,
                            max_response_output_tokens: 4096
                        }
                    });
                    
                    resolve();
                });

                this.openaiWs.once('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

        } catch (error) {
            console.error(`❌ Erro ao inicializar sessão ${this.sessionId}:`, error);
            throw error;
        }
    }

    setupOpenAIWebSocketHandlers() {
        this.openaiWs.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                // Log de eventos importantes
                if (message.type === 'session.created') {
                    console.log(`🎉 Sessão criada: ${message.session.id}`);
                } else if (message.type === 'error') {
                    console.error(`❌ Erro da OpenAI:`, message.error);
                } else if (message.type === 'response.audio.delta') {
                    // Áudio recebido da OpenAI - repassar para o cliente
                    if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                        this.clientWs.send(JSON.stringify({
                            type: 'audio_delta',
                            audio: message.delta
                        }));
                    }
                } else if (message.type === 'input_audio_buffer.speech_started') {
                    console.log(`🎤 Fala detectada na sessão ${this.sessionId}`);
                    this.lastSpeechDetection = Date.now();
                    
                    // Se a IA estiver respondendo, cancelar para evitar sobreposição
                    if (this.isAIResponding) {
                        console.log(`⚡ Cancelando resposta da IA devido a nova fala do usuário`);
                        this.sendToOpenAI({
                            type: 'response.cancel'
                        });
                        this.isAIResponding = false;
                    }
                } else if (message.type === 'input_audio_buffer.speech_stopped') {
                    console.log(`🔇 Fim da fala na sessão ${this.sessionId}`);
                } else if (message.type === 'response.audio.done') {
                    this.isAIResponding = false;
                } else if (message.type === 'response.created') {
                    this.isAIResponding = true;
                }

                // Repassar todas as mensagens para o cliente (exceto áudio que já foi tratado)
                if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN && message.type !== 'response.audio.delta') {
                    this.clientWs.send(JSON.stringify({
                        type: 'openai_event',
                        event: message
                    }));
                }

            } catch (error) {
                console.error('❌ Erro ao processar mensagem da OpenAI:', error);
            }
        });

        this.openaiWs.on('close', (code, reason) => {
            console.log(`🔌 Conexão OpenAI fechada: ${code} - ${reason}`);
            this.isConnected = false;
            
            if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                this.clientWs.send(JSON.stringify({
                    type: 'connection_closed',
                    reason: 'OpenAI connection closed'
                }));
            }
        });

        this.openaiWs.on('error', (error) => {
            console.error(`❌ Erro na conexão OpenAI:`, error);
            if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                this.clientWs.send(JSON.stringify({
                    type: 'error',
                    message: 'Erro na conexão com OpenAI'
                }));
            }
        });
    }

    setupClientWebSocketHandlers() {
        this.clientWs.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                if (message.type === 'audio_data') {
                    // Áudio do cliente - enviar para OpenAI
                    this.sendToOpenAI({
                        type: 'input_audio_buffer.append',
                        audio: message.audio
                    });
                } else if (message.type === 'commit_audio') {
                    // Cliente terminou de enviar áudio
                    this.sendToOpenAI({
                        type: 'input_audio_buffer.commit'
                    });
                } else if (message.type === 'cancel_response') {
                    // Cancelar resposta atual
                    this.sendToOpenAI({
                        type: 'response.cancel'
                    });
                }

            } catch (error) {
                console.error('❌ Erro ao processar mensagem do cliente:', error);
            }
        });

        this.clientWs.on('close', () => {
            console.log(`🔌 Cliente desconectado: ${this.sessionId}`);
            this.cleanup();
        });

        this.clientWs.on('error', (error) => {
            console.error(`❌ Erro na conexão do cliente:`, error);
        });
    }

    sendToOpenAI(message) {
        if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
            this.openaiWs.send(JSON.stringify(message));
        } else {
            console.warn('⚠️ Tentativa de enviar mensagem para OpenAI com conexão fechada');
        }
    }

    cleanup() {
        if (this.openaiWs) {
            this.openaiWs.close();
        }
        activeSessions.delete(this.sessionId);
        console.log(`🧹 Sessão limpa: ${this.sessionId}`);
    }
}

// Criar servidor HTTP
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📁 Arquivos estáticos servidos de: ${path.join(__dirname, 'public')}`);
});

// Criar servidor WebSocket
const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws, req) => {
    const sessionId = uuidv4();
    console.log(`🔗 Nova conexão WebSocket: ${sessionId}`);

    try {
        // Criar e inicializar sessão OpenAI
        const session = new OpenAIRealtimeSession(sessionId);
        activeSessions.set(sessionId, session);

        await session.initialize(ws);

        // Enviar confirmação de conexão para o cliente
        ws.send(JSON.stringify({
            type: 'connection_established',
            sessionId: sessionId,
            message: 'Conectado com sucesso à OpenAI Realtime API'
        }));

    } catch (error) {
        console.error(`❌ Erro ao estabelecer sessão ${sessionId}:`, error);
        
        ws.send(JSON.stringify({
            type: 'connection_error',
            message: 'Erro ao conectar com OpenAI: ' + error.message
        }));
        
        ws.close();
        activeSessions.delete(sessionId);
    }
});

// Rota de status da API
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        activeSessions: activeSessions.size,
        timestamp: new Date().toISOString(),
        model: OPENAI_REALTIME_MODEL
    });
});

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada não tratada:', reason);
});

// Limpeza ao encerrar o processo
process.on('SIGINT', () => {
    console.log('\n🛑 Encerrando servidor...');
    
    // Fechar todas as sessões ativas
    activeSessions.forEach(session => {
        session.cleanup();
    });
    
    server.close(() => {
        console.log('✅ Servidor encerrado com sucesso');
        process.exit(0);
    });
});

console.log('🎯 Configuração:');
console.log(`   - Modelo OpenAI: ${OPENAI_REALTIME_MODEL}`);
console.log(`   - Porta: ${PORT}`);
console.log(`   - Ambiente: ${process.env.NODE_ENV || 'development'}`);
console.log('📝 Logs serão exibidos aqui...\n');

