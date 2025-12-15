document.addEventListener('DOMContentLoaded', () => {
    
    // ============================================================
    // 🔴 CONFIGURE AQUI SEU N8N
    // ============================================================
    const WEBHOOK_URL = "https://SEU-N8N-AQUI/webhook/vestibular-femaf"; 
    
    // --- CONFIGURAÇÕES ---
    const MIN_CHARS = 1000;
    const MAX_CHARS = 2000;
    const EXAM_DURATION_SEC = 3 * 60 * 60; // 3 Horas
    const STORAGE_KEY = 'femaf_mvp_v1';

    // --- DOM ELEMENTS ---
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

    // --- INICIALIZAÇÃO ---
    checkSession();

    function checkSession() {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (data && data.active) {
            const now = Date.now();
            if (now > data.deadline) {
                alert("O tempo da sua prova expirou.");
                localStorage.removeItem(STORAGE_KEY);
                return;
            }
            restoreSession(data);
        }
    }

    function restoreSession(data) {
        introOverlay.classList.add('intro-fade-out');
        mainContainer.classList.remove('hidden-section');
        
        // Preenche campos ocultos e visuais
        document.getElementById('sidebarName').value = data.name;
        document.getElementById('sidebarCourse').value = data.course;
        document.getElementById('realNameInput').value = data.name;
        document.getElementById('realPhoneInput').value = data.phone;
        document.getElementById('realCourseInput').value = data.course;
        
        redacaoInput.value = data.text || "";
        updateCounter(redacaoInput.value.length);
        
        startTimer((data.deadline - Date.now()) / 1000);
        activateFraudProtection();
    }

    // --- LOGIN / INÍCIO ---
    // Máscara de telefone simples
    inpPhone.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g,"");
        v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
        e.target.value = v;
    });

    startBtn.addEventListener('click', () => {
        const name = inpName.value.trim();
        const phone = inpPhone.value.replace(/\D/g, "");
        const course = inpCourse.value.trim();

        if (name.length < 3 || phone.length < 10 || course.length < 3) {
            errorMsg.classList.remove('hidden');
            return;
        }

        // Cria sessão
        const deadline = Date.now() + (EXAM_DURATION_SEC * 1000);
        const sessionData = { active: true, name, phone, course, deadline, text: "" };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
        
        restoreSession(sessionData);
    });

    // --- EDITOR & TEMPO ---
    redacaoInput.addEventListener('input', (e) => {
        const text = e.target.value;
        updateCounter(text.length);
        
        // Salva rascunho
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if(data) {
            data.text = text;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
    });

    function updateCounter(len) {
        charCounter.textContent = len;
        if (len < MIN_CHARS || len > MAX_CHARS) {
            charCounter.style.color = '#ef4444'; // Red
        } else {
            charCounter.style.color = '#16a34a'; // Green
        }
    }

    function startTimer(seconds) {
        clearInterval(timerInterval);
        let timer = seconds;
        
        timerInterval = setInterval(() => {
            if (timer <= 0) {
                clearInterval(timerInterval);
                document.getElementById('closureReason').value = 'tempo_esgotado';
                submitExam(true); // Força envio
                return;
            }
            
            timer--;
            const h = Math.floor(timer / 3600).toString().padStart(2, '0');
            const m = Math.floor((timer % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(timer % 60).toString().padStart(2, '0');
            displayTimer.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    // --- ANTIFRAUDE (RÍGIDO) ---
    function activateFraudProtection() {
        // 1. Bloqueia Colar
        redacaoInput.addEventListener('paste', (e) => {
            e.preventDefault();
            alert("É proibido colar texto. A prova será encerrada se persistir.");
            // Opcional: Descomentar linha abaixo para encerrar imediatamente no paste
            // triggerFraudEnd("tentativa_colar"); 
        });

        // 2. Bloqueia Saída da Tela (Blur)
        window.addEventListener('blur', () => {
            if (!isSubmitting && localStorage.getItem(STORAGE_KEY)) {
               triggerFraudEnd("saiu_da_tela_foco_perdido");
            }
        });
    }

    function triggerFraudEnd(reason) {
        document.getElementById('closureReason').value = reason;
        modalFraud.classList.remove('hidden');
        submitExam(true); // Envio forçado
    }

    // --- ENVIO ---
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const len = redacaoInput.value.length;
        
        if (len < MIN_CHARS || len > MAX_CHARS) {
            document.getElementById('currentCharsDisplay').textContent = len;
            modalError.classList.remove('hidden');
            return;
        }
        submitExam(false);
    });

    closeErrorBtn.addEventListener('click', () => {
        modalError.classList.add('hidden');
    });

    async function submitExam(forced) {
        if (isSubmitting) return;
        isSubmitting = true;
        
        submitBtn.disabled = true;
        submitBtn.innerText = "Enviando...";

        const payload = {
            nome: document.getElementById('realNameInput').value,
            telefone: document.getElementById('realPhoneInput').value,
            curso: document.getElementById('realCourseInput').value,
            redacao: redacaoInput.value,
            caracteres: redacaoInput.value.length,
            motivo: document.getElementById('closureReason').value,
            data_envio: new Date().toISOString()
        };

        try {
            // Tenta enviar para o n8n
            if(WEBHOOK_URL.includes("http")) {
                await fetch(WEBHOOK_URL, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' }
                });
            } else {
                // Simulação local para teste se URL vazia
                console.log("Simulando envio:", payload);
                await new Promise(r => setTimeout(r, 1500));
            }

            // Limpa sessão e mostra sucesso (ou fraude se for o caso)
            localStorage.removeItem(STORAGE_KEY);
            clearInterval(timerInterval);

            if (!forced) {
                document.getElementById('submitDate').textContent = new Date().toLocaleDateString();
                document.getElementById('protocolDisplay').textContent = "FEMAF-" + Math.floor(Math.random()*10000);
                mainContainer.classList.add('hidden-section');
                modalSuccess.classList.remove('hidden');
            } else {
                // Se foi forçado (fraude/tempo), mantém o modal de fraude aberto e esconde a prova
                mainContainer.classList.add('hidden-section');
            }

        } catch (err) {
            alert("Erro ao enviar. Verifique sua conexão e tente novamente.");
            isSubmitting = false;
            submitBtn.disabled = false;
            submitBtn.innerText = "Entregar Prova";
        }
    }
});