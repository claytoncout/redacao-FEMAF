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
        STORAGE_KEY: 'femaf_mvp_session_v17' 
    };

    const COURSES_DB = {
        "Presencial": [
            "Educação Física", "Pedagogia", "Psicologia", 
            "Serviço Social", "Direito", "Farmácia", "Engenharia Civil"
        ],
        "EAD": [
            "Administração", "Ciências Contábeis", "Serviço Social", 
            "Pedagogia", "Tecnólogo em Agronegócios"
        ]
    };

    // ============================================================
    // 🖥️ UI ELEMENTS
    // ============================================================
    const UI = {
        screens: { 
            intro: document.getElementById('intro-overlay'), 
            exam: document.getElementById('main-exam-container') 
        },
        inputs: {
            // Novos campos da intro
            description: document.getElementById('introDescription'), // Texto descritivo
            badges: document.getElementById('introBadges'),         // Badges de tempo/chars
            
            entryMethod: document.getElementById('entryMethod'),
            enemContainer: document.getElementById('enemFields'),
            enemYear: document.getElementById('enemYear'),
            enemScore: document.getElementById('enemScore'),
            
            name: document.getElementById('introName'),
            phone: document.getElementById('introPhone'),
            course: document.getElementById('introCourse'),
            modality: document.getElementById('introModality'),
            redacao: document.getElementById('redacao'),
            hiddenName: document.getElementById('sidebarName'),
            hiddenCourse: document.getElementById('sidebarCourse')
        },
        buttons: {
            start: document.getElementById('startExamBtn'),
            submit: document.getElementById('submitBtn'),
            closeError: document.getElementById('closeErrorBtn'),
            restart: document.getElementById('restartExamBtn')
        },
        feedback: {
            loginError: document.getElementById('loginError'),
            charCounter: document.getElementById('charCounter'),
            timer: document.getElementById('displayTimer'),
            countError: document.getElementById('currentCharsDisplay'),
            protocol: document.getElementById('protocolDisplay'),
            date: document.getElementById('submitDate'),
            successTitle: document.getElementById('successTitle'),
            successDesc: document.getElementById('successDesc')
        },
        modals: {
            success: document.getElementById('successMessage'),
            error: document.getElementById('errorMessage'),
            fraud: document.getElementById('fraudMessage')
        }
    };
    
    let state = { timerInterval: null, isSubmitting: false };

    // ============================================================
    // INIT
    // ============================================================
    init();

    function init() {
        checkSession();
        setupEventListeners();
        if (localStorage.getItem(CONFIG.STORAGE_KEY)) {
            activateSecurityMonitors();
        }
    }

    function checkSession() {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return; 
        const data = JSON.parse(raw);
        
        if (data.status === 'finished') {
            localStorage.removeItem(CONFIG.STORAGE_KEY);
        } else if (data.status === 'running') {
            initializeExamInterface(data);
        }
    }

    function setupEventListeners() {
        UI.inputs.phone.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g,"");
            v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
            e.target.value = v;
        });

        UI.inputs.modality.addEventListener('change', updateCourseOptions);
        UI.inputs.entryMethod.addEventListener('change', updateEntryMethodUI);

        UI.buttons.start.addEventListener('click', handleLogin);
        
        UI.buttons.closeError.addEventListener('click', (e) => {
            e.preventDefault(); 
            UI.modals.error.classList.add('hidden');
            UI.inputs.redacao.focus(); 
        });

        if (UI.buttons.restart) {
            UI.buttons.restart.addEventListener('click', (e) => {
                e.preventDefault();
                UI.modals.fraud.classList.add('hidden');
                UI.inputs.redacao.value = ""; 
                UI.inputs.redacao.focus();
                updateCharCounter({ target: { value: "" } });
            });
        }

        UI.inputs.redacao.addEventListener('input', updateCharCounter);
        document.getElementById('contactForm').addEventListener('submit', handleSubmit);
    }

    // 🟢 FUNÇÃO UI DINÂMICA
    function updateEntryMethodUI() {
        const method = UI.inputs.entryMethod.value;
        const btn = UI.buttons.start;
        const desc = UI.inputs.description;
        const badges = UI.inputs.badges;

        // Reset inicial (garantia)
        UI.inputs.enemContainer.classList.add('hidden');
        badges.classList.add('hidden'); // Começa oculto por padrão na troca
        
        switch (method) {
            case 'prova_online':
                desc.textContent = "Preencha seus dados para iniciar a prova de redação agora.";
                badges.classList.remove('hidden'); // Mostra os badges só na prova
                btn.innerHTML = 'Iniciar Prova <i class="ph-bold ph-arrow-right"></i>';
                break;

            case 'enem':
                desc.textContent = "Informe sua nota e ano de realização para analisarmos sua aprovação imediata.";
                UI.inputs.enemContainer.classList.remove('hidden'); // Mostra campos do ENEM
                btn.innerHTML = 'Enviar Inscrição <i class="ph-bold ph-paper-plane-right"></i>';
                break;

            case 'transferencia':
                desc.textContent = "Preencha os dados abaixo para darmos andamento ao seu processo de transferência.";
                btn.innerHTML = 'Solicitar Transferência <i class="ph-bold ph-paper-plane-right"></i>';
                break;
                
            default:
                desc.textContent = "Selecione uma forma de ingresso para continuar.";
                break;
        }
    }

    function updateCourseOptions() {
        const selectedModality = UI.inputs.modality.value;
        const courseSelect = UI.inputs.course;
        courseSelect.innerHTML = '<option value="" disabled selected>Selecione o curso...</option>';
        
        if (COURSES_DB[selectedModality]) {
            COURSES_DB[selectedModality].forEach(courseName => {
                const option = document.createElement('option');
                option.value = courseName;
                option.textContent = courseName;
                courseSelect.appendChild(option);
            });
            courseSelect.disabled = false;
        } else {
            courseSelect.disabled = true;
            courseSelect.innerHTML = '<option value="" disabled selected>Selecione a modalidade acima primeiro</option>';
        }
    }

    // ============================================================
    // 1. LÓGICA DE CADASTRO / LOGIN
    // ============================================================
    async function handleLogin() {
        const name = UI.inputs.name.value.trim();
        const rawPhone = UI.inputs.phone.value.replace(/\D/g, ""); 
        const course = UI.inputs.course.value;
        const modality = UI.inputs.modality.value; 
        const method = UI.inputs.entryMethod.value;

        // 🛑 VALIDAÇÃO 1
        if (!method) {
            showLoginError("Por favor, selecione a Forma de Ingresso.");
            UI.inputs.entryMethod.focus();
            return;
        }

        // 🛑 VALIDAÇÃO 2
        if (name.length < 3 || rawPhone.length < 10 || !course || !modality) {
            showLoginError("Preencha todos os campos pessoais e de curso.");
            return;
        }

        // 🛑 VALIDAÇÃO 3 (ENEM)
        let enemData = {};
        if (method === 'enem') {
            const year = UI.inputs.enemYear.value;
            const score = UI.inputs.enemScore.value;
            if (!year || !score) {
                showLoginError("Informe o ano e a nota do ENEM.");
                return;
            }
            enemData = { enem_ano: year, enem_nota: score };
        }

        // UI Loading
        const originalBtnText = UI.buttons.start.innerHTML;
        UI.buttons.start.disabled = true;
        UI.buttons.start.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Processando...';
        UI.feedback.loginError.classList.add('hidden');

        const internationalPhone = "+55" + rawPhone; 
        
        let actionType = "inicio-prova";
        if (method === 'enem') actionType = "cadastro-enem";
        if (method === 'transferencia') actionType = "cadastro-transferencia";

        try {
            const payload = { 
                acao: actionType, 
                nome: name, 
                telefone: internationalPhone, 
                curso: course,
                modalidade: modality,
                ...enemData
            };

            const response = await sendToWebhook(payload);

            if (method === 'prova_online') {
                if (response && response.autorizado === true) {
                    startExamSession(name, internationalPhone, course, modality);
                } else {
                    showContactSupportError(response.mensagem || "Acesso não autorizado.");
                    resetLoginButton(originalBtnText);
                }
            } else {
                finishRegistrationSuccess();
            }

        } catch (error) {
            console.error(error);
            showContactSupportError("Erro de comunicação com o servidor.");
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
    // 2. SESSÃO DA PROVA
    // ============================================================
    function startExamSession(name, phone, course, modality) {
        const deadline = Date.now() + (CONFIG.EXAM_DURATION_SEC * 1000);
        const sessionData = { active: true, status: 'running', name, phone, course, modality, deadline };
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
            if (timer <= 0) { 
                alert("Tempo Esgotado!"); 
                handleSubmit(new Event('submit')); 
                clearInterval(state.timerInterval);
                return; 
            }
            timer--;
            const safeTimer = timer < 0 ? 0 : timer;
            const h = Math.floor(safeTimer / 3600).toString().padStart(2, '0');
            const m = Math.floor((safeTimer % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(safeTimer % 60).toString().padStart(2, '0');
            UI.feedback.timer.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    function updateCharCounter(e) {
        const val = e.target ? e.target.value : "";
        const len = val.length;
        UI.feedback.charCounter.textContent = len;
        UI.feedback.charCounter.style.color = (len < CONFIG.MIN_CHARS || len > CONFIG.MAX_CHARS) ? '#ef4444' : '#16a34a';
    }

    // ============================================================
    // 3. SEGURANÇA E SUBMIT
    // ============================================================
    function activateSecurityMonitors() {
        window.removeEventListener('blur', handleTabViolation);
        document.addEventListener('contextmenu', event => event.preventDefault());
        window.addEventListener('blur', handleTabViolation);
    }

    function handleTabViolation() {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.status !== 'running' || state.isSubmitting) return;

        UI.inputs.redacao.value = "";
        updateCharCounter({ target: { value: "" } });
        UI.screens.exam.classList.remove('hidden-section');
        UI.modals.fraud.classList.remove('hidden');
    }

    async function handleSubmit(e) {
        if(e) e.preventDefault();
        
        const len = UI.inputs.redacao.value.length;
        
        if (len < CONFIG.MIN_CHARS || len > CONFIG.MAX_CHARS) {
            UI.modals.error.classList.remove('hidden');
            UI.feedback.countError.textContent = len;
            return;
        }

        if (state.isSubmitting) return;
        state.isSubmitting = true;
        UI.buttons.submit.disabled = true;
        UI.buttons.submit.innerText = "Enviando...";

        const data = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
        if(data) { data.status = 'finished'; localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data)); }

        try {
            await sendToWebhook({ 
                acao: "fim-prova", 
                observacoes: "Entregue com sucesso", 
                redacao: UI.inputs.redacao.value 
            });
            finishExamSuccess();
        } catch (error) {
            alert("Erro de conexão. Tire print e envie no WhatsApp.");
            UI.buttons.submit.disabled = false;
            state.isSubmitting = false;
        }
    }

    // ============================================================
    // 4. SUCESSO
    // ============================================================
    
    function finishExamSuccess() {
        clearInterval(state.timerInterval);
        UI.screens.exam.classList.add('hidden-section');
        UI.feedback.successTitle.textContent = "Prova Recebida!";
        UI.feedback.successDesc.textContent = "Sua redação foi enviada com sucesso para nossa equipe de correção.";
        UI.feedback.date.textContent = new Date().toLocaleDateString();
        UI.feedback.protocol.textContent = "FEMAF-" + Math.floor(Math.random()*100000);
        UI.modals.success.classList.remove('hidden');
    }

    function finishRegistrationSuccess() {
        UI.feedback.successTitle.textContent = "Cadastro Realizado!";
        UI.feedback.successDesc.innerHTML = "Recebemos suas informações com sucesso.<br>Nossa equipe entrará em contato em breve pelo WhatsApp.";
        UI.feedback.date.textContent = new Date().toLocaleDateString();
        UI.feedback.protocol.textContent = "REQ-" + Math.floor(Math.random()*100000);
        UI.modals.success.classList.remove('hidden');
    }

    async function sendToWebhook(payloadExtra) {
        const stored = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || {};
        let phoneFinal = stored.phone;
        
        if (!phoneFinal) {
            const inputVal = UI.inputs.phone.value.replace(/\D/g, "");
            if (inputVal.length >= 10) phoneFinal = "+55" + inputVal;
        }
        
        const baseData = {
            nome: stored.name || UI.inputs.name.value,
            telefone: phoneFinal, 
            curso: stored.course || UI.inputs.course.value,
            modalidade: stored.modality || UI.inputs.modality.value, 
            data_evento: new Date().toISOString()
        };
        
        const finalPayload = { ...baseData, ...payloadExtra };
        if (finalPayload.redacao) finalPayload.caracteres = finalPayload.redacao.length;

        const response = await fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(finalPayload)
        });
        if (!response.ok) throw new Error(`Status: ${response.status}`);
        return await response.json();
    }
});
