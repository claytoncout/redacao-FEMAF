document.addEventListener('DOMContentLoaded', () => {
    
    // ============================================================
    // ⚙️ CONFIGURAÇÕES
    // ============================================================
    const CONFIG = {
        WEBHOOK_URL: "https://n8n-libs-production.up.railway.app/webhook/femaf", 
        SUPPORT_PHONE: "5511999999999", 
        MIN_CHARS: 1000,
        MAX_CHARS: 2000,
        EXAM_DURATION_SEC: 3 * 60 * 60, 
        STORAGE_KEY: 'femaf_mvp_session_v9' 
    };

    // ============================================================
    // 🖥️ ELEMENTOS DE TELA
    // ============================================================
    const UI = {
        screens: { intro: document.getElementById('intro-overlay'), exam: document.getElementById('main-exam-container') },
        inputs: {
            name: document.getElementById('introName'),
            phone: document.getElementById('introPhone'),
            course: document.getElementById('introCourse'),
            redacao: document.getElementById('redacao'),
            hiddenName: document.getElementById('sidebarName'),
            hiddenCourse: document.getElementById('sidebarCourse')
        },
        buttons: {
            start: document.getElementById('startExamBtn'),
            submit: document.getElementById('submitBtn'),
            closeError: document.getElementById('closeErrorBtn')
        },
        feedback: {
            loginError: document.getElementById('loginError'),
            charCounter: document.getElementById('charCounter'),
            timer: document.getElementById('displayTimer'),
            countError: document.getElementById('currentCharsDisplay'),
            protocol: document.getElementById('protocolDisplay'),
            date: document.getElementById('submitDate')
        },
        modals: {
            success: document.getElementById('successMessage'),
            error: document.getElementById('errorMessage'), // Usaremos este para avisos também
            fraud: document.getElementById('fraudMessage')
        }
    };
    
    let state = { timerInterval: null, isSubmitting: false };

    init();

    function init() {
        checkSession();
        setupEventListeners();
    }

    function checkSession() {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return; 
        const data = JSON.parse(raw);
        
        if (data.status === 'running') {
            handleFraud("Página recarregada (F5) durante a prova");
            return; 
        }
        if (data.status === 'finished' || data.status === 'blocked') {
            localStorage.removeItem(CONFIG.STORAGE_KEY);
        }
    }

    function setupEventListeners() {
        UI.inputs.phone.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g,"");
            v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
            e.target.value = v;
        });

        UI.buttons.start.addEventListener('click', handleLogin);
        UI.inputs.redacao.addEventListener('input', updateCharCounter);
        document.getElementById('contactForm').addEventListener('submit', handleSubmit);
        
        // Botão de fechar modal (Serve para erro e para aviso de colar)
        UI.buttons.closeError.addEventListener('click', (e) => {
            e.preventDefault(); 
            UI.modals.error.classList.add('hidden');
            UI.inputs.redacao.focus(); // Devolve o foco para o texto
        });
    }

    // ============================================================
    // LÓGICA DE LOGIN
    // ============================================================
    async function handleLogin() {
        const name = UI.inputs.name.value.trim();
        const rawPhone = UI.inputs.phone.value.replace(/\D/g, ""); 
        const course = UI.inputs.course.value;

        if (name.length < 3 || rawPhone.length < 10 || !course) {
            showLoginError("Preencha todos os campos corretamente.");
            return;
        }

        const originalBtnText = UI.buttons.start.innerHTML;
        UI.buttons.start.disabled = true;
        UI.buttons.start.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Verificando...';
        UI.feedback.loginError.classList.add('hidden');

        const internationalPhone = "+55" + rawPhone; 

        try {
            const response = await sendToWebhook({ acao: "inicio-prova", nome: name, telefone: internationalPhone, curso: course });

            if (response && response.autorizado === true) {
                startExamSession(name, internationalPhone, course);
            } else {
                showContactSupportError(response.mensagem || "Acesso não autorizado.");
                resetLoginButton(originalBtnText);
            }
        } catch (error) {
            showContactSupportError("Erro de conexão com o servidor.");
            resetLoginButton(originalBtnText);
        }
    }

    function resetLoginButton(text) {
        UI.buttons.start.disabled = false;
        UI.buttons.start.innerHTML = text;
    }

    function showContactSupportError(customMsg) {
        const msg = `${customMsg}<br><a href="https://wa.me/${CONFIG.SUPPORT_PHONE}" target="_blank" style="color:var(--danger);font-weight:800;text-decoration:underline;">Falar com Suporte</a>`;
        UI.feedback.loginError.innerHTML = `<div style="text-align:center"><i class="ph-bold ph-lock-key"></i> ${msg}</div>`;
        UI.feedback.loginError.classList.remove('hidden');
    }

    function showLoginError(msg) {
        UI.feedback.loginError.innerHTML = `<i class="ph-bold ph-warning-circle"></i> ${msg}`;
        UI.feedback.loginError.classList.remove('hidden');
    }

    // ============================================================
    // SISTEMA DA PROVA
    // ============================================================
    function startExamSession(name, phone, course) {
        const deadline = Date.now() + (CONFIG.EXAM_DURATION_SEC * 1000);
        const sessionData = { active: true, status: 'running', name, phone, course, deadline };
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(sessionData));
        initializeExamInterface(sessionData);
    }

    function initializeExamInterface(data) {
        UI.screens.intro.classList.add('intro-fade-out');
        setTimeout(() => UI.screens.intro.style.display = 'none', 500);
        UI.screens.exam.classList.remove('hidden-section');
        
        UI.inputs.hiddenName.value = data.name;
        UI.inputs.hiddenCourse.value = data.course;
        
        startTimer((data.deadline - Date.now()) / 1000);
        activateSecurityMonitors();
    }

    function startTimer(seconds) {
        clearInterval(state.timerInterval);
        let timer = seconds;
        state.timerInterval = setInterval(() => {
            if (timer <= 0) { handleFraud("Tempo esgotado"); return; }
            timer--;
            const h = Math.floor(timer / 3600).toString().padStart(2, '0');
            const m = Math.floor((timer % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(timer % 60).toString().padStart(2, '0');
            UI.feedback.timer.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    // ============================================================
    // 🛡️ SEGURANÇA E AVISOS (AQUI ESTÁ A CORREÇÃO DO COLAR)
    // ============================================================
    function activateSecurityMonitors() {
        // CORREÇÃO: Ao colar, apenas avisa (não bloqueia a prova)
        UI.inputs.redacao.addEventListener('paste', (e) => {
            e.preventDefault(); // Impede o texto de aparecer
            showPasteWarning(); // Mostra o aviso bonito
        });

        UI.inputs.redacao.addEventListener('input', updateCharCounter);

        window.addEventListener('blur', () => {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (!state.isSubmitting && raw) {
                handleFraud("Saiu da tela (Aba minimizada)");
            }
        });
        
        document.addEventListener('contextmenu', event => event.preventDefault());
    }

    function showPasteWarning() {
        // Manipula o Modal de Erro para parecer um Aviso
        const modal = UI.modals.error;
        const icon = modal.querySelector('.icon-circle');
        const title = modal.querySelector('h2');
        const text = modal.querySelector('p');
        const details = modal.querySelector('.error-details');
        const btn = document.getElementById('closeErrorBtn');

        // Estilo de Aviso (Amarelo)
        icon.className = 'icon-circle warning'; // Usa classe warning do CSS
        icon.innerHTML = '<i class="ph-bold ph-hand-palm"></i>'; // Ícone de Pare/Mão
        title.innerText = "Função Bloqueada";
        text.innerHTML = "Para garantir a integridade da avaliação, <strong>não é permitido colar textos</strong>.<br>Por favor, digite sua redação.";
        details.style.display = 'none'; // Esconde detalhes técnicos
        btn.innerText = "Entendi, vou digitar";
        
        modal.classList.remove('hidden');
    }

    function handleFraud(reason) {
        if (state.isSubmitting) return;
        const data = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
        if (data && data.status === 'blocked') return;

        clearInterval(state.timerInterval);
        state.isSubmitting = true; 

        if(data) {
            data.status = 'blocked';
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
        }

        UI.screens.exam.classList.add('hidden-section'); // AQUI QUE "APAGA" A TELA (Só na fraude real)
        UI.modals.fraud.classList.remove('hidden');
        
        sendToWebhook({ acao: "bloquear-aluno", observacoes: reason, redacao: UI.inputs.redacao.value });
    }

    function updateCharCounter(e) {
        const len = e.target.value.length;
        UI.feedback.charCounter.textContent = len;
        UI.feedback.charCounter.style.color = (len < CONFIG.MIN_CHARS || len > CONFIG.MAX_CHARS) ? '#ef4444' : '#16a34a';
    }

    // ============================================================
    // ENVIO FINAL
    // ============================================================
    async function handleSubmit(e) {
        e.preventDefault();
        const len = UI.inputs.redacao.value.length;
        
        // Verifica tamanho (Erro Vermelho)
        if (len < CONFIG.MIN_CHARS || len > CONFIG.MAX_CHARS) {
            const modal = UI.modals.error;
            const icon = modal.querySelector('.icon-circle');
            const title = modal.querySelector('h2');
            const text = modal.querySelector('p');
            const details = modal.querySelector('.error-details');
            const btn = document.getElementById('closeErrorBtn');

            // Restaura Estilo de Erro (Vermelho)
            icon.className = 'icon-circle error';
            icon.innerHTML = '<i class="ph-bold ph-ruler"></i>';
            title.innerText = "Tamanho Inválido";
            text.innerText = `Sua redação deve ter entre ${CONFIG.MIN_CHARS} e ${CONFIG.MAX_CHARS} caracteres.`;
            details.style.display = 'block';
            UI.feedback.countError.textContent = len;
            btn.innerText = "Voltar e Corrigir";
            
            modal.classList.remove('hidden');
            return;
        }

        if (state.isSubmitting) return;
        state.isSubmitting = true;
        UI.buttons.submit.disabled = true;
        UI.buttons.submit.innerText = "Enviando...";

        const data = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
        if(data) { data.status = 'finished'; localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data)); }

        try {
            await sendToWebhook({ acao: "fim-prova", observacoes: "Entregue com sucesso", redacao: UI.inputs.redacao.value });
            finishExamSuccess();
        } catch (error) {
            alert("Erro de conexão. Tire um print da redação e envie no WhatsApp.");
            UI.buttons.submit.disabled = false;
            state.isSubmitting = false;
        }
    }

    function finishExamSuccess() {
        clearInterval(state.timerInterval);
        UI.screens.exam.classList.add('hidden-section');
        UI.feedback.date.textContent = new Date().toLocaleDateString();
        UI.feedback.protocol.textContent = "FEMAF-" + Math.floor(Math.random()*100000);
        UI.modals.success.classList.remove('hidden');
    }

    async function sendToWebhook(payloadExtra) {
        const stored = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || {};
        let phoneToSend = stored.phone || ("+55" + UI.inputs.phone.value.replace(/\D/g, ""));
        
        const payload = { 
            ...{ nome: stored.name || UI.inputs.name.value, telefone: phoneToSend, curso: stored.course || UI.inputs.course.value, data_evento: new Date().toISOString() }, 
            ...payloadExtra 
        };
        if (payload.redacao) payload.caracteres = payload.redacao.length;

        console.log("Enviando:", payload);
        const response = await fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Status: ${response.status}`);
        return await response.json();
    }
});