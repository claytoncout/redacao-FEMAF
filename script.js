document.addEventListener('DOMContentLoaded', () => {
    
    // ============================================================
    // 🔴 URL DO WEBHOOK
    // ============================================================
    const WEBHOOK_URL = "https://SEU-N8N-AQUI/webhook/vestibular-femaf"; 
    
    // CONFIGURAÇÕES
    const MIN_CHARS = 1000;
    const MAX_CHARS = 2000;
    const EXAM_DURATION_SEC = 3 * 60 * 60; // 3 Horas
    const STORAGE_KEY = 'femaf_exam_session_v2'; // Mudei a chave para evitar conflito com versões antigas

    // ELEMENTOS
    const introOverlay = document.getElementById('intro-overlay');
    const mainContainer = document.getElementById('main-exam-container');
    const startBtn = document.getElementById('startExamBtn');
    
    const inpName = document.getElementById('introName');
    const inpPhone = document.getElementById('introPhone');
    const inpCourse = document.getElementById('introCourse'); // Agora é um Select
    const errorMsg = document.getElementById('loginError');

    const form = document.getElementById('contactForm');
    const redacaoInput = document.getElementById('redacao');
    const charCounter = document.getElementById('charCounter');
    const displayTimer = document.getElementById('displayTimer');
    const submitBtn = document.getElementById('submitBtn');

    // Modais
    const modalSuccess = document.getElementById('successMessage');
    const modalError = document.getElementById('errorMessage');
    const modalFraud = document.getElementById('fraudMessage');
    const closeErrorBtn = document.getElementById('closeErrorBtn');
    
    let timerInterval;
    let isSubmitting = false;

    // --- 1. GERENCIAMENTO DE ESTADO E REFRESH ---
    checkSession();

    function checkSession() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const data = JSON.parse(raw);
        
        // Se já foi finalizado ou bloqueado, não deixa entrar de novo
        if (data.status === 'finished' || data.status === 'blocked') {
            alert("Esta prova já foi finalizada ou bloqueada.");
            localStorage.removeItem(STORAGE_KEY);
            return;
        }

        // DETECÇÃO DE REFRESH (Página Recarregada)
        // Se existe sessão ativa no storage, mas estamos no 'checkSession' (load da página),
        // significa que o usuário recarregou a página durante a prova.
        if (data.active) {
            // AQUI APLICAMOS A REGRA DE BLOQUEIO POR REFRESH
            handleFraud("Página recarregada");
            return; 
        }
    }

    // --- 2. SISTEMA DE ENVIOS (EVENT DRIVEN) ---
    async function sendEvent(action, observation = null, finalRedaction = "") {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        
        // Pega dados dos inputs ou do storage
        const payload = {
            acao: action, // inicio-prova | fim-prova | bloquear-aluno
            observacoes: observation, // Motivo do bloqueio ou obs geral
            aluno: {
                nome: inpName.value || stored.name,
                telefone: inpPhone.value || stored.phone,
                curso: inpCourse.value || stored.course
            },
            prova: {
                redacao: finalRedaction, // Só preenchido no fim
                caracteres: finalRedaction.length,
                data_evento: new Date().toISOString()
            }
        };

        console.log(`[Event: ${action}]`, payload);

        // Disparo Fire-and-Forget (não bloqueia a UI, exceto no submit final)
        if(WEBHOOK_URL && WEBHOOK_URL.includes("http")) {
            try {
                await fetch(WEBHOOK_URL, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) {
                console.error("Erro ao enviar webhook", e);
            }
        }
    }

    // --- 3. INÍCIO DA PROVA ---
    inpPhone.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g,"");
        v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
        e.target.value = v;
    });

    startBtn.addEventListener('click', async () => {
        const name = inpName.value.trim();
        const phone = inpPhone.value.replace(/\D/g, "");
        const course = inpCourse.value;

        if (name.length < 3 || phone.length < 10 || !course) {
            errorMsg.classList.remove('hidden');
            return;
        }

        // Salva estado inicial
        const deadline = Date.now() + (EXAM_DURATION_SEC * 1000);
        const sessionData = { 
            active: true, 
            status: 'running',
            name, phone, course, deadline 
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
        
        // UI
        startBtn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Iniciando...';
        
        // Dispara evento de INÍCIO
        await sendEvent("inicio-prova", "Aluno iniciou a avaliação");

        // Troca de tela
        initializeExamInterface(sessionData);
    });

    function initializeExamInterface(data) {
        introOverlay.classList.add('intro-fade-out');
        setTimeout(() => introOverlay.style.display = 'none', 500); // Remove do fluxo
        mainContainer.classList.remove('hidden-section');
        
        // Preenche sidebar
        document.getElementById('sidebarName').value = data.name;
        document.getElementById('sidebarCourse').value = data.course;
        
        startTimer((data.deadline - Date.now()) / 1000);
        activateSecurityMonitors();
    }

    // --- 4. EDITOR & TEMPO ---
    redacaoInput.addEventListener('input', (e) => {
        const len = e.target.value.length;
        charCounter.textContent = len;
        charCounter.style.color = (len < MIN_CHARS || len > MAX_CHARS) ? '#ef4444' : '#16a34a';
    });

    function startTimer(seconds) {
        clearInterval(timerInterval);
        let timer = seconds;
        
        timerInterval = setInterval(() => {
            if (timer <= 0) {
                handleFraud("Tempo esgotado"); // Trata como bloqueio/fim forçado
                return;
            }
            timer--;
            const h = Math.floor(timer / 3600).toString().padStart(2, '0');
            const m = Math.floor((timer % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(timer % 60).toString().padStart(2, '0');
            displayTimer.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    // --- 5. SEGURANÇA (ANTIFRAUDE) ---
    function activateSecurityMonitors() {
        // Bloqueia Colar
        redacaoInput.addEventListener('paste', (e) => {
            e.preventDefault();
            handleFraud("Suspeita de colar");
        });

        // Bloqueia Saída da Tela (Blur)
        window.addEventListener('blur', () => {
            if (localStorage.getItem(STORAGE_KEY) && !isSubmitting) {
                handleFraud("Aluno saiu da tela");
            }
        });
        
        // Bloqueia menu de contexto
        document.addEventListener('contextmenu', event => event.preventDefault());
    }

    // Função central de Bloqueio
    function handleFraud(reason) {
        // Evita múltiplos disparos
        if (isSubmitting) return;
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (data && data.status === 'blocked') return;

        clearInterval(timerInterval);
        isSubmitting = true; // Trava novos envios

        // Atualiza Storage para 'blocked'
        if(data) {
            data.status = 'blocked';
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }

        // Mostra Modal
        mainContainer.classList.add('hidden-section');
        modalFraud.classList.remove('hidden');
        
        // Envia Webhook de Bloqueio
        // Mandamos o texto que ele conseguiu escrever até o momento
        sendEvent("bloquear-aluno", reason, redacaoInput.value);
    }

    // --- 6. ENVIO FINAL (SUCESSO) ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const len = redacaoInput.value.length;
        
        if (len < MIN_CHARS || len > MAX_CHARS) {
            document.getElementById('currentCharsDisplay').textContent = len;
            modalError.classList.remove('hidden');
            return;
        }

        if (isSubmitting) return;
        isSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.innerText = "Enviando...";

        // Marca como finalizado no storage
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if(data) {
            data.status = 'finished';
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }

        await sendEvent("fim-prova", "Prova entregue com sucesso", redacaoInput.value);

        clearInterval(timerInterval);
        mainContainer.classList.add('hidden-section');
        
        // Atualiza recibo visual
        document.getElementById('submitDate').textContent = new Date().toLocaleDateString();
        document.getElementById('protocolDisplay').textContent = "FEMAF-" + Math.floor(Math.random()*10000);
        modalSuccess.classList.remove('hidden');
    });

    closeErrorBtn.addEventListener('click', () => modalError.classList.add('hidden'));
});