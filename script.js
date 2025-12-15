document.addEventListener('DOMContentLoaded', () => {
    
    // ============================================================
    // ⚙️ CONFIGURAÇÕES GERAIS
    // ============================================================
    const WEBHOOK_URL = "https://n8n-libs-production.up.railway.app/webhook-test/femaf"; 
    const SUPPORT_PHONE = "5599999999999"; // 🔴 SEU NUMERO DE SUPORTE (Para o link do WhatsApp)
    const SUPPORT_PHONE_VISUAL = "(99) 99999-9999"; 
    
    const MIN_CHARS = 1000;
    const MAX_CHARS = 2000;
    const EXAM_DURATION_SEC = 3 * 60 * 60; // 3 Horas
    const STORAGE_KEY = 'femaf_mvp_session_v7'; // Versão atualizada

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
    // 1. CHECAGEM DE SESSÃO (APENAS F5 DURANTE PROVA)
    // ============================================================
    checkSession();

    function checkSession() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return; 

        const data = JSON.parse(raw);
        
        // Se a prova estava RODANDO e a página recarregou -> FRAUDE
        if (data.status === 'running') {
            handleFraud("Página recarregada (F5) durante a prova");
            return; 
        }

        // Se estava bloqueado ou finalizado, limpamos a sessão local
        // para permitir que ele tente logar de novo (e receba a msg do servidor se ainda estiver bloqueado)
        if (data.status === 'finished' || data.status === 'blocked') {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    // ============================================================
    // 2. LÓGICA DE LOGIN (COM +55)
    // ============================================================
    
    // Máscara Visual (O aluno vê (11) 9xxxx-xxxx)
    inpPhone.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g,"");
        v = v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
        e.target.value = v;
    });

    startBtn.addEventListener('click', async () => {
        const name = inpName.value.trim();
        const rawPhone = inpPhone.value.replace(/\D/g, ""); // Apenas números: 11958009674
        const course = inpCourse.value;

        // Validação local
        if (name.length < 3 || rawPhone.length < 10 || !course) {
            showLoginError("Preencha todos os campos corretamente.");
            return;
        }

        // UX: Botão carregando
        const originalBtnText = startBtn.innerHTML;
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Verificando...';
        errorMsg.classList.add('hidden');

        // Formatação para o Webhook (+55 + DDD + Numero)
        const internationalPhone = "+55" + rawPhone; 

        try {
            // Envia para o n8n validar
            const response = await sendToWebhook({
                acao: "inicio-prova",
                nome: name,
                telefone: internationalPhone, // Envia: +5511958009674
                curso: course
            });

            // Se o Webhook retornar { autorizado: true }
            if (response && response.autorizado === true) {
                // SUCESSO: Inicia a prova
                startExamSession(name, internationalPhone, course);
            } else {
                // ERRO / BLOQUEIO: Mostra a mensagem vermelha, mas mantém na tela de login
                const msgServer = response.mensagem || "Acesso bloqueado. Entre em contato com a secretaria.";
                showContactSupportError(msgServer);
                
                // Libera o botão para tentar de novo (caso a secretaria desbloqueie)
                startBtn.disabled = false;
                startBtn.innerHTML = originalBtnText;
            }

        } catch (error) {
            console.error("Erro no fluxo:", error);
            showLoginError("Erro de conexão. Verifique sua internet.");
            startBtn.disabled = false;
            startBtn.innerHTML = originalBtnText;
        }
    });

    // Mostra erro com link do WhatsApp
    function showContactSupportError(customMsg) {
        const msg = `
            ${customMsg}<br>
            <a href="https://wa.me/${SUPPORT_PHONE}?text=Ola,%20estou%20bloqueado%20na%20prova" 
               target="_blank" 
               style="color: var(--danger); font-weight: 800; text-decoration: underline; margin-top:5px; display:inline-block;">
               Falar com Suporte
            </a>
        `;
        errorMsg.innerHTML = `<div style="text-align:center"><i class="ph-bold ph-lock-key"></i> ${msg}</div>`;
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
        // Se já estiver bloqueado, não faz nada
        if (data && data.status === 'blocked') return;

        clearInterval(timerInterval);
        isSubmitting = true; 

        if(data) {
            data.status = 'blocked';
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }

        // Mostra modal de bloqueio
        mainContainer.classList.add('hidden-section');
        modalFraud.classList.remove('hidden');
        
        // Envia motivo para o N8N
        // OBS: Aqui usamos os dados do storage, que já tem o telefone com +55
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
    // 4. SUBMIT FINAL
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
            alert("Erro ao enviar. Verifique conexão.");
            submitBtn.disabled = false;
            isSubmitting = false;
        }
    });

    closeErrorBtn.addEventListener('click', (e) => {
        e.preventDefault(); 
        modalError.classList.add('hidden');
    });

    // ============================================================
    // 📡 FUNÇÃO DE ENVIO CENTRALIZADA
    // ============================================================
    async function sendToWebhook(payloadExtra) {
        // Tenta pegar do storage ou usa os inputs
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        
        // Se tiver no storage, já está com +55. Se pegar do input, precisa tratar.
        let phoneToSend;
        if (stored.phone) {
            phoneToSend = stored.phone;
        } else {
            // Caso seja o primeiro envio (Login)
            const rawInput = inpPhone.value.replace(/\D/g, "");
            phoneToSend = "+55" + rawInput;
        }

        const baseData = {
            nome: stored.name || inpName.value,
            telefone: phoneToSend,
            curso: stored.course || inpCourse.value,
            data_evento: new Date().toISOString()
        };

        // Sobrescreve com o payload específico (ex: telefone do login que já vem tratado)
        const finalPayload = { ...baseData, ...payloadExtra };
        
        if (finalPayload.redacao) {
            finalPayload.caracteres = finalPayload.redacao.length;
        }

        console.log("Enviando JSON:", finalPayload);

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