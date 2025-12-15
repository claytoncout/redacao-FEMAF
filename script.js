document.addEventListener('DOMContentLoaded', () => {
    
    // ============================================================
    // ⚙️ CONFIGURAÇÕES GERAIS
    // ============================================================
    const WEBHOOK_URL = "https://n8n-libs-production.up.railway.app/webhook/femaf"; 
    const SUPPORT_PHONE = "5599999999999"; // 🔴 COLOQUE O NUMERO DA FEMAF AQUI (COM DDI 55 + DDD)
    const SUPPORT_PHONE_VISUAL = "(99) 99999-9999"; // O que aparece escrito na tela
    
    const MIN_CHARS = 1000;
    const MAX_CHARS = 2000;
    const EXAM_DURATION_SEC = 3 * 60 * 60; // 3 Horas
    const STORAGE_KEY = 'femaf_mvp_session_v6'; 

    // ============================================================
    // 🖥️ ELEMENTOS DO DOM
    // ============================================================
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
    // 1. CHECAGEM DE SESSÃO
    // ============================================================
    checkSession();

    function checkSession() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return; 

        const data = JSON.parse(raw);
        
        if (data.status === 'finished' || data.status === 'blocked') {
            forceBlockScreen("Prova já finalizada.");
            return;
        }

        if (data.status === 'running') {
            handleFraud("Página recarregada (F5) durante a prova");
            return; 
        }
    }

    function forceBlockScreen(msg) {
        alert(msg);
        introOverlay.style.display = 'flex';
        startBtn.disabled = true;
        startBtn.innerText = "Acesso Bloqueado";
    }

    // ============================================================
    // 2. LÓGICA DE LOGIN (INICIO-PROVA)
    // ============================================================
    
    inpPhone.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g,"");
        v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
        e.target.value = v;
    });

    startBtn.addEventListener('click', async () => {
        const name = inpName.value.trim();
        const rawPhone = inpPhone.value.replace(/\D/g, ""); 
        const course = inpCourse.value;

        if (name.length < 3 || rawPhone.length < 10 || !course) {
            showLoginError("Preencha todos os campos corretamente.");
            return;
        }

        // UX: Botão carregando
        const originalBtnText = startBtn.innerHTML;
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Verificando...';
        errorMsg.classList.add('hidden');

        try {
            const response = await sendToWebhook({
                acao: "inicio-prova",
                nome: name,
                telefone: rawPhone,
                curso: course
            });

            // LÓGICA DE DECISÃO RÍGIDA
            // Só passa se autorizado for EXPLICITAMENTE true
            if (response && response.autorizado === true) {
                startExamSession(name, rawPhone, course);
            } else {
                // Qualquer outra coisa (false, null, undefined, vazio) cai aqui
                showContactSupportError();
                startBtn.disabled = false;
                startBtn.innerHTML = originalBtnText;
            }

        } catch (error) {
            console.error("Erro no fluxo:", error);
            // Erro de rede ou servidor fora do ar também cai no suporte
            showContactSupportError();
            startBtn.disabled = false;
            startBtn.innerHTML = originalBtnText;
        }
    });

    // Função específica para direcionar ao WhatsApp
    function showContactSupportError() {
        const msg = `
            Houve um problema com seu processo seletivo.<br>
            Entre em contato com a secretaria: 
            <a href="https://wa.me/${SUPPORT_PHONE}?text=Ola,%20tive%20problema%20ao%20acessar%20a%20prova" 
               target="_blank" 
               style="color: var(--danger); font-weight: 800; text-decoration: underline;">
               ${SUPPORT_PHONE_VISUAL}
            </a>
        `;
        errorMsg.innerHTML = `<i class="ph-bold ph-whatsapp-logo"></i> <span>${msg}</span>`;
        errorMsg.classList.remove('hidden');
    }

    function showLoginError(msg) {
        errorMsg.innerHTML = `<i class="ph-bold ph-warning-circle"></i> ${msg}`;
        errorMsg.classList.remove('hidden');
    }

    function startExamSession(name, phone, course) {
        const deadline = Date.now() + (EXAM_DURATION_SEC * 1000);
        const sessionData = { 
            active: true, 
            status: 'running', 
            name, phone, course, deadline 
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
        initializeExamInterface(sessionData);
    }

    function initializeExamInterface(data) {
        introOverlay.classList.add('intro-fade-out');
        setTimeout(() => introOverlay.style.display = 'none', 500);
        mainContainer.classList.remove('hidden-section');
        
        document.getElementById('sidebarName').value = data.name;
        document.getElementById('sidebarCourse').value = data.course;
        
        startTimer((data.deadline - Date.now()) / 1000);
        activateSecurityMonitors();
    }

    // ============================================================
    // 3. SISTEMA DE PROVA (TIMER & MONITOR)
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
        redacaoInput.addEventListener('paste', (e) => {
            e.preventDefault();
            handleFraud("Suspeita de colar (Paste)");
        });
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
        
        sendToWebhook({
            acao: "bloquear-aluno",
            observacoes: reason,
            redacao: redacaoInput.value
        });
    }

    redacaoInput.addEventListener('input', (e) => {
        const len = e.target.value.length;
        charCounter.textContent = len;
        charCounter.style.color = (len < MIN_CHARS || len > MAX_CHARS) ? '#ef4444' : '#16a34a';
    });

    // ============================================================
    // 4. SUBMIT E ENVIO
    // ============================================================
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

        try {
            await sendToWebhook({
                acao: "fim-prova",
                observacoes: "Entregue com sucesso",
                redacao: redacaoInput.value
            });
            
            clearInterval(timerInterval);
            mainContainer.classList.add('hidden-section');
            document.getElementById('submitDate').textContent = new Date().toLocaleDateString();
            document.getElementById('protocolDisplay').textContent = "FEMAF-" + Math.floor(Math.random()*100000);
            modalSuccess.classList.remove('hidden');

        } catch (error) {
            alert("Erro de conexão. Se o problema persistir, tire print da redação e envie no WhatsApp.");
            submitBtn.disabled = false;
            isSubmitting = false;
        }
    });

    closeErrorBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        modalError.classList.add('hidden');
    });

    async function sendToWebhook(payloadExtra) {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        const baseData = {
            nome: stored.name || inpName.value,
            telefone: stored.phone || inpPhone.value.replace(/\D/g, ""),
            curso: stored.course || inpCourse.value,
            data_evento: new Date().toISOString()
        };

        const finalPayload = { ...baseData, ...payloadExtra };
        
        if (finalPayload.redacao) {
            finalPayload.caracteres = finalPayload.redacao.length;
        }

        console.log("Enviando:", finalPayload);

        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json' 
            },
            body: JSON.stringify(finalPayload)
        });

        if (!response.ok) throw new Error(`Status: ${response.status}`);
        return await response.json();
    }
});