document.addEventListener('DOMContentLoaded', () => {
    
    // ============================================================
    // ⚙️ CONFIGURAÇÕES & DADOS DOS CURSOS
    // ============================================================
    const CONFIG = {
        WEBHOOK_URL: "https://n8n-libs-production.up.railway.app/webhook/femaf", 
        SUPPORT_PHONE: "5511999999999", 
        MIN_CHARS: 10,  // ⚠️ ALTERADO DE 1000 PARA 10 PARA VOCÊ CONSEGUIR TESTAR
        MAX_CHARS: 2000,
        EXAM_DURATION_SEC: 3 * 60 * 60, 
        STORAGE_KEY: 'femaf_mvp_session_v15' 
    };

    // Lista de cursos por modalidade
    const COURSES_DB = {
        "Presencial": [
            "Educação Física", "Pedagogia", "Psicologia", 
            "Serviço Social", "Direito", "Farmácia", "Engenharia Civil"
        ],
        "EAD": [
            "Administração", "Ciências Contábeis", 
            "Serviço Social", "Pedagogia", "Tecnólogo em Agronegócios"
        ]
    };

    // ============================================================
    // 🖥️ CACHE DE ELEMENTOS
    // ============================================================
    const UI = {
        screens: { intro: document.getElementById('intro-overlay'), exam: document.getElementById('main-exam-container') },
        inputs: {
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
            date: document.getElementById('submitDate')
        },
        modals: {
            success: document.getElementById('successMessage'),
            error: document.getElementById('errorMessage'),
            fraud: document.getElementById('fraudMessage')
        }
    };
    
    let state = { timerInterval: null, isSubmitting: false };

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================
    init();

    function init() {
        console.log("Sistema iniciado. Carregando eventos..."); // Log para debug
        checkSession();
        setupEventListeners();
        if (localStorage.getItem(CONFIG.STORAGE_KEY)) {
            activateSecurityMonitors();
        }
    }

    function checkSession() {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (!raw) return; 
            const data = JSON.parse(raw);
            
            if (data.status === 'finished') {
                localStorage.removeItem(CONFIG.STORAGE_KEY);
            } else if (data.status === 'running') {
                initializeExamInterface(data);
            }
        } catch (e) {
            console.error("Erro ao ler sessão:", e);
            localStorage.removeItem(CONFIG.STORAGE_KEY); // Limpa se estiver corrompido
        }
    }

    function setupEventListeners() {
        // Máscara Telefone
        if(UI.inputs.phone) {
            UI.inputs.phone.addEventListener('input', (e) => {
                let v = e.target.value.replace(/\D/g,"");
                v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
                e.target.value = v;
            });
        }

        // Filtro de Cursos
        if(UI.inputs.modality) UI.inputs.modality.addEventListener('change', updateCourseOptions);

        // Login
        if(UI.buttons.start) UI.buttons.start.addEventListener('click', handleLogin);
        
        // Botões de Modais
        if(UI.buttons.closeError) {
            UI.buttons.closeError.addEventListener('click', (e) => {
                e.preventDefault(); 
                UI.modals.error.classList.add('hidden');
                UI.inputs.redacao.focus(); 
            });
        }

        if (UI.buttons.restart) {
            UI.buttons.restart.addEventListener('click', (e) => {
                e.preventDefault();
                UI.modals.fraud.classList.add('hidden');
                UI.inputs.redacao.value = ""; 
                UI.inputs.redacao.focus();
                updateCharCounter({ target: { value: "" } });
            });
        }

        // Editor e Envio
        if(UI.inputs.redacao) {
            UI.inputs.redacao.addEventListener('input', updateCharCounter);
        }
        
        const contactForm = document.getElementById('contactForm');
        if(contactForm) {
            contactForm.addEventListener('submit', handleSubmit);
        } else {
            console.error("Formulário contactForm não encontrado!");
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
    // 1. LOGIN
    // ============================================================
    async function handleLogin() {
        const name = UI.inputs.name.value.trim();
        const rawPhone = UI.inputs.phone.value.replace(/\D/g, ""); 
        const course = UI.inputs.course.value;
        const modality = UI.inputs.modality.value; 

        if (name.length < 3 || rawPhone.length < 10 || !course || !modality) {
            showLoginError("Preencha todos os campos corretamente.");
            return;
        }

        const originalBtnText = UI.buttons.start.innerHTML;
        UI.buttons.start.disabled = true;
        UI.buttons.start.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Verificando...';
        UI.feedback.loginError.classList.add('hidden');

        const internationalPhone = "+55" + rawPhone; 

        try {
            // Envia para o Webhook (N8N)
            const response = await sendToWebhook({ 
                acao: "inicio-prova", 
                nome: name, 
                telefone: internationalPhone, 
                curso: course,
                modalidade: modality 
            });

            // Verifica se o N8N retornou autorizado
            if (response && (response.autorizado === true || response.status === 'cadastrado' || response.status === 'reativado')) {
                startExamSession(name, internationalPhone, course, modality);
            } else {
                // Caso contrário
                console.log("Resposta do servidor:", response);
                if(response.erro) {
                    showContactSupportError(response.message || "Usuário não encontrado ou bloqueado.");
                } else {
                    // Se não tiver resposta clara, assumimos sucesso para teste ou tratamos erro
                    // Para produção, descomente a linha abaixo e remova o startExamSession do else
                    // showContactSupportError("Acesso não autorizado.");
                    startExamSession(name, internationalPhone, course, modality); // Fallback para teste
                }
                resetLoginButton(originalBtnText);
            }
        } catch (error) {
            console.error("Erro login:", error);
            // Em caso de erro de rede, para evitar travar o aluno, você pode decidir liberar ou bloquear
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
            // Evita números negativos
            if(timer < 0) timer = 0;
            
            const h = Math.floor(timer / 3600).toString().padStart(2, '0');
            const m = Math.floor((timer % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(timer % 60).toString().padStart(2, '0');
            UI.feedback.timer.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    function updateCharCounter(e) {
        const val = e.target ? e.target.value : "";
        const len = val.length;
        UI.feedback.charCounter.textContent = len;
        
        // Validação visual da cor
        if (len < CONFIG.MIN_CHARS || len > CONFIG.MAX_CHARS) {
            UI.feedback.charCounter.style.color = '#ef4444'; // Vermelho
        } else {
            UI.feedback.charCounter.style.color = '#16a34a'; // Verde
        }
    }

    // ============================================================
    // 3. SEGURANÇA E VIOLAÇÃO DE ABA
    // ============================================================
    function activateSecurityMonitors() {
        window.removeEventListener('blur', handleTabViolation);
        document.addEventListener('contextmenu', event => event.preventDefault());
        window.addEventListener('blur', handleTabViolation);
    }

    function handleTabViolation() {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return;
        
        try {
            const data = JSON.parse(raw);
            if (data.status !== 'running' || state.isSubmitting) return;

            // 1. Limpa o texto
            UI.inputs.redacao.value = "";
            updateCharCounter({ target: { value: "" } });

            // 2. Garante que a prova esteja visível
            UI.screens.exam.classList.remove('hidden-section');

            // 3. Mostra o modal
            UI.modals.fraud.classList.remove('hidden');
        } catch(e) { console.log("Erro monitoramento", e); }
    }

    // ============================================================
    // 4. ENVIO FINAL
    // ============================================================
    async function handleSubmit(e) {
        if(e) e.preventDefault();
        
        const len = UI.inputs.redacao.value.length;
        console.log("Tentando enviar. Caracteres:", len);

        // Validação de Tamanho
        if (len < CONFIG.MIN_CHARS || len > CONFIG.MAX_CHARS) {
            const modal = UI.modals.error;
            modal.querySelector('.icon-circle').className = 'icon-circle error';
            modal.querySelector('.icon-circle').innerHTML = '<i class="ph-bold ph-ruler"></i>';
            modal.querySelector('h2').innerText = "Tamanho Inválido";
            modal.querySelector('p').innerText = `Sua redação deve ter entre ${CONFIG.MIN_CHARS} e ${CONFIG.MAX_CHARS} caracteres.`;
            modal.querySelector('.error-details').style.display = 'block';
            document.getElementById('closeErrorBtn').innerText = "Voltar e Corrigir";
            UI.feedback.countError.textContent = len;
            modal.classList.remove('hidden');
            return;
        }

        if (state.isSubmitting) return;
        state.isSubmitting = true;
        UI.buttons.submit.disabled = true;
        UI.buttons.submit.innerText = "Enviando...";

        const data = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
        if(data) { 
            data.status = 'finished'; 
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data)); 
        }

        try {
            await sendToWebhook({ 
                acao: "fim-prova", 
                observacoes: "Entregue com sucesso", 
                redacao: UI.inputs.redacao.value 
            });
            finishExamSuccess();
        } catch (error) {
            console.error(error);
            alert("Erro de conexão. Verifique sua internet, tire um print e envie no WhatsApp.");
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
        let phoneFinal = stored.phone;
        
        // Fallback se não tiver no storage
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

        console.log("Enviando Webhook:", finalPayload);

        const response = await fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(finalPayload)
        });
        
        if (!response.ok) throw new Error(`Status: ${response.status}`);
        return await response.json();
    }
});
