document.addEventListener('DOMContentLoaded', () => {
    
    // ============================================================
    // 🔴 COLE AQUI SUA URL DO N8N
    // ============================================================
    const WEBHOOK_URL = "https://primary-production-f8d8.up.railway.app/webhook-test/redacao-online-mvf"; 
    
    // CONFIGURAÇÕES
    const MIN_CHARS = 1000;
    const MAX_CHARS = 2000;
    const EXAM_DURATION_SEC = 3 * 60 * 60; // 3 Horas
    const STORAGE_KEY = 'femaf_exam_session_v4'; // Versão 4 (Flat JSON)

    // ELEMENTOS DOM
    const introOverlay = document.getElementById('intro-overlay');
    const mainContainer = document.getElementById('main-exam-container');
    const startBtn = document.getElementById('startExamBtn');
    
    const inpName = document.getElementById('introName');
    const inpPhone = document.getElementById('introPhone');
    const inpCourse = document.getElementById('introCourse');
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

    // ============================================================
    // 1. CHECAGEM DE SESSÃO E ANTI-REFRESH
    // ============================================================
    checkSession();

    function checkSession() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return; 

        const data = JSON.parse(raw);
        
        // Bloqueia se já finalizou
        if (data.status === 'finished' || data.status === 'blocked') {
            blockAccess("Prova já finalizada ou bloqueada.");
            return;
        }

        // Bloqueia se deu F5 (Refresh) com a prova rodando
        if (data.status === 'running') {
            handleFraud("Página recarregada durante a prova");
            return; 
        }
    }

    function blockAccess(msg) {
        alert(msg);
        introOverlay.style.display = 'flex';
        startBtn.disabled = true;
        startBtn.innerText = "Acesso Negado";
    }

    // ============================================================
    // 2. LOGIN COM VALIDAÇÃO (JSON PLANO)
    // ============================================================
    
    // Máscara Visual (apenas para UX, o envio será limpo)
    inpPhone.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g,"");
        v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
        e.target.value = v;
    });

    startBtn.addEventListener('click', async () => {
        const name = inpName.value.trim();
        const rawPhone = inpPhone.value.replace(/\D/g, ""); // LIMPEZA DO TELEFONE
        const course = inpCourse.value;

        // Validação básica
        if (name.length < 3 || rawPhone.length < 10 || !course) {
            showLoginError("Preencha todos os campos corretamente.");
            return;
        }

        // UX: Botão carregando
        const originalBtnText = startBtn.innerHTML;
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Validando...';
        errorMsg.classList.add('hidden');

        try {
            // PAYLOAD PLANO PARA O N8N
            const loginPayload = {
                acao: "solicitar-acesso",
                nome: name,
                telefone: rawPhone, // Envia: 11999999999
                curso: course
            };

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(loginPayload)
            });

            if (!response.ok) throw new Error("Erro no servidor.");

            const authData = await response.json();

            // Espera resposta: { "autorizado": true }
            if (authData.autorizado === true) {
                startExamSession(name, rawPhone, course);
            } else {
                showLoginError(authData.mensagem || "Acesso negado.");
                startBtn.disabled = false;
                startBtn.innerHTML = originalBtnText;
            }

        } catch (error) {
            console.error(error);
            showLoginError("Erro de conexão. Tente novamente.");
            startBtn.disabled = false;
            startBtn.innerHTML = originalBtnText;
        }
    });

    function showLoginError(msg) {
        errorMsg.innerHTML = `<i class="ph-bold ph-warning-circle"></i> ${msg}`;
        errorMsg.classList.remove('hidden');
    }

    function startExamSession(name, phone, course) {
        const deadline = Date.now() + (EXAM_DURATION_SEC * 1000);
        
        // Salva sessão localmente
        const sessionData = { 
            active: true, 
            status: 'running', 
            name, phone, course, deadline 
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
        
        // Dispara evento de início
        sendEvent("inicio-prova", "Prova iniciada");

        initializeExamInterface(sessionData);
    }

    function initializeExamInterface(data) {
        introOverlay.classList.add('intro-fade-out');
        setTimeout(() => introOverlay.style.display = 'none', 500);
        mainContainer.classList.remove('hidden-section');
        
        // Preenche sidebar (Visual)
        document.getElementById('sidebarName').value = data.name;
        document.getElementById('sidebarCourse').value = data.course;
        
        startTimer((data.deadline - Date.now()) / 1000);
        activateSecurityMonitors();
    }

    // ============================================================
    // 3. MONITORAMENTO E EDITOR
    // ============================================================
    function startTimer(seconds) {
        clearInterval(timerInterval);
        let timer = seconds;
        
        timerInterval = setInterval(() => {
            if (timer <= 0) {
                handleFraud("Tempo esgotado"); 
                return;
            }
            timer--;
            const h = Math.floor(timer / 3600).toString().padStart(2, '0');
            const m = Math.floor((timer % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(timer % 60).toString().padStart(2, '0');
            displayTimer.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    function activateSecurityMonitors() {
        // Antifraude: Colar
        redacaoInput.addEventListener('paste', (e) => {
            e.preventDefault();
            handleFraud("Suspeita de colar (Paste)");
        });

        // Antifraude: Saiu da tela (Blur)
        window.addEventListener('blur', () => {
            if (!isSubmitting && localStorage.getItem(STORAGE_KEY)) {
                handleFraud("Saiu da tela (Aba minimizada)");
            }
        });
        
        document.addEventListener('contextmenu', event => event.preventDefault());
    }

    function handleFraud(reason) {
        if (isSubmitting) return;

        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (data && data.status === 'blocked') return;

        clearInterval(timerInterval);
        isSubmitting = true; 

        if(data) {
            data.status = 'blocked';
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }

        mainContainer.classList.add('hidden-section');
        modalFraud.classList.remove('hidden');
        
        // Envia bloqueio
        sendEvent("bloquear-aluno", reason, redacaoInput.value);
    }

    redacaoInput.addEventListener('input', (e) => {
        const len = e.target.value.length;
        charCounter.textContent = len;
        charCounter.style.color = (len < MIN_CHARS || len > MAX_CHARS) ? '#ef4444' : '#16a34a';
    });


    // ============================================================
    // 4. ENVIO DE DADOS (FLAT JSON & CLEAN PHONE)
    // ============================================================
    
    async function sendEvent(action, observation = null, finalRedaction = "") {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        
        // Dados recuperados do storage ou dos inputs
        const currentName = stored.name || inpName.value;
        const currentPhone = stored.phone || inpPhone.value.replace(/\D/g, ""); // Garante limpeza
        const currentCourse = stored.course || inpCourse.value;

        // PAYLOAD PLANO (FLAT)
        const payload = {
            acao: action, 
            observacoes: observation,
            nome: currentName,
            telefone: currentPhone, // Ex: 11958009674
            curso: currentCourse,
            redacao: finalRedaction,
            caracteres: finalRedaction.length,
            data_evento: new Date().toISOString()
        };

        if(WEBHOOK_URL.includes("http")) {
            try {
                if (action === 'solicitar-acesso') return; 

                await fetch(WEBHOOK_URL, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) {
                console.error("Webhook error:", e);
            }
        }
    }

    // Submit Final
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

        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if(data) {
            data.status = 'finished';
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }

        await sendEvent("fim-prova", "Prova entregue com sucesso", redacaoInput.value);

        clearInterval(timerInterval);
        mainContainer.classList.add('hidden-section');
        
        document.getElementById('submitDate').textContent = new Date().toLocaleDateString();
        document.getElementById('protocolDisplay').textContent = "FEMAF-" + Math.floor(Math.random()*100000);
        modalSuccess.classList.remove('hidden');
    });

    closeErrorBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        modalError.classList.add('hidden');
    });
});