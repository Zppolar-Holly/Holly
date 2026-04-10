/**
 * Dashboard Holly - Gerenciamento de Bot Discord
 * Versão: 2.5.0
 * Autor: Zppolar
 * Data: 2023
 * Melhorias: Segurança, Tratamento de Erros, Performance
 */

document.addEventListener('DOMContentLoaded', async function() {
    // Configurações atualizadas
    // Same origin as the page so session cookies (holly_token) are sent. Override only if API is on another host.
    const CONFIG = {
        CLIENT_ID: '1069819161057968218',
        API_BASE_URL: window.__HOLLY_API__ || window.location.origin,
        DEFAULT_AVATAR: 'https://cdn.discordapp.com/embed/avatars/0.png',
        THEME_KEY: 'holly_theme',
        TOKEN_EXPIRATION_CHECK: true
    };

    // Elementos da UI (atualizado com novos seletores)
    const UI = {
        loginBtn: document.getElementById('login-btn'),
        userDropdown: document.getElementById('userDropdown'),
        navUserAvatar: document.getElementById('nav-user-avatar'),
        navUsername: document.getElementById('nav-username'),
        userAvatar: document.getElementById('user-avatar'),
        username: document.getElementById('username'),
        userDiscriminator: document.getElementById('user-discriminator'),
        statusDot: document.querySelector('.user-status .status-dot'),
        statusText: document.querySelector('.user-status .status-text'),
        userPlan: document.querySelector('.user-plan .plan-badge'),
        serversGrid: document.getElementById('serversGrid'),
        serverCount: document.getElementById('server-count'),
        commandCount: document.getElementById('command-count'),
        userCount: document.getElementById('user-count'),
        uptimePercent: document.getElementById('uptime-percent'),
        hamburger: document.getElementById('hamburger'),
        navbarMenu: document.getElementById('navbarMenu'),
        sidebarToggle: document.getElementById('sidebarToggle'),
        closeSidebar: document.getElementById('closeSidebar'),
        dashboardSidebar: document.getElementById('dashboardSidebar'),
        dashboardContent: document.getElementById('dashboardContent'),
        themeToggle: document.querySelector('.theme-toggle'),
        themeIcon: document.getElementById('themeIcon'),
        feedbackBtn: document.getElementById('feedbackBtn'),
        feedbackModal: document.getElementById('feedbackModal'),
        closeModal: document.querySelector('.close-modal'),
        feedbackForm: document.getElementById('feedbackForm'),
        loadingOverlay: document.getElementById('loadingOverlay'),
        currentTime: document.getElementById('current-time'),
        overlay: document.getElementById('overlay') || document.createElement('div') // Fallback seguro
    };

    // Estado da aplicação (atualizado)
    const STATE = {
        user: null,
        guilds: [],
        stats: null,
        theme: localStorage.getItem(CONFIG.THEME_KEY) || 'light',
        isSidebarOpen: false,
        isMobileMenuOpen: false,
        isOverlayVisible: false,
        lastScrollPosition: 0,
        charts: {
            activity: null,
            commands: null
        }
    };

    // Inicialização (atualizada com tratamento de erro)
    async function init() {
        try {
            setupEventListeners();
            setupOverlay();
            initSidebarState();
            applyTheme();
            updateActiveLink();
            
            showLoading(true);
            await checkAuth();
            
            if (STATE.user) {
                await Promise.all([
                    initCharts(),
                    updateClock()
                ]);
                setInterval(updateClock, 60000);
            }
        } catch (error) {
            console.error('Initialization error:', error);
            showNotification('Erro ao carregar dashboard. Tente recarregar a página.', 'error');
        } finally {
            showLoading(false);
        }
    }

    // Configurar estado inicial da sidebar (melhorado)
    function initSidebarState() {
        const isMobile = window.innerWidth <= 768;
        STATE.isSidebarOpen = !isMobile;
        
        if (UI.dashboardSidebar) {
            UI.dashboardSidebar.classList.toggle('active', STATE.isSidebarOpen);
        }
        
        if (UI.dashboardContent) {
            UI.dashboardContent.classList.toggle('sidebar-active', STATE.isSidebarOpen);
            UI.dashboardContent.classList.toggle('sidebar-closed', !STATE.isSidebarOpen && window.innerWidth > 768);
        }
        
        if (UI.overlay) {
            UI.overlay.style.display = 'none';
            UI.overlay.style.opacity = '0';
        }
        
        updateSidebarControls();
    }

    // Atualizar controles da sidebar (melhorado)
    function updateSidebarControls() {
        if (UI.sidebarToggle) {
            UI.sidebarToggle.classList.toggle('active', STATE.isSidebarOpen);
            UI.sidebarToggle.setAttribute('aria-expanded', STATE.isSidebarOpen);
            UI.sidebarToggle.style.zIndex = STATE.isSidebarOpen ? '1002' : 'auto';
        }
        
        if (UI.closeSidebar) {
            UI.closeSidebar.style.display = STATE.isSidebarOpen ? 'block' : 'none';
        }
    }

    // Configurar overlay (melhorado)
    function setupOverlay() {
        if (!UI.overlay) return;
        
        UI.overlay.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
        UI.overlay.style.display = 'none';
    }

    // Alternar sidebar (melhorado com acessibilidade)
    function toggleSidebar() {
        STATE.isSidebarOpen = !STATE.isSidebarOpen;
        STATE.isOverlayVisible = STATE.isSidebarOpen && window.innerWidth <= 768;
        
        if (UI.dashboardSidebar) {
            UI.dashboardSidebar.classList.toggle('active', STATE.isSidebarOpen);
        }
        
        if (UI.dashboardContent) {
            UI.dashboardContent.classList.toggle('sidebar-active', STATE.isSidebarOpen);
            
            if (window.innerWidth > 768) {
                UI.dashboardContent.classList.toggle('sidebar-closed', !STATE.isSidebarOpen);
            }
        }
        
        if (UI.overlay) {
            if (window.innerWidth <= 768) {
                UI.overlay.style.display = STATE.isOverlayVisible ? 'block' : 'none';
                setTimeout(() => {
                    UI.overlay.style.opacity = STATE.isOverlayVisible ? '1' : '0';
                }, 10);
            } else {
                UI.overlay.style.display = 'none';
            }
        }
        
        if (window.innerWidth <= 768) {
            document.body.style.overflow = STATE.isSidebarOpen ? 'hidden' : '';
        }
        
        updateSidebarControls();
    }

    // Configurar event listeners (melhorado)
    function setupEventListeners() {
        // Autenticação
        if (UI.loginBtn) {
            UI.loginBtn.addEventListener('click', handleAuthClick);
            UI.loginBtn.setAttribute('aria-label', 'Login com Discord');
        }

        // Dropdown do usuário
        if (UI.userDropdown) {
            const dropdownToggle = UI.userDropdown.querySelector('.dropdown-toggle');
            if (dropdownToggle) {
                dropdownToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    UI.userDropdown.classList.toggle('active');
                    dropdownToggle.setAttribute('aria-expanded', 
                        UI.userDropdown.classList.contains('active'));
                });
                dropdownToggle.setAttribute('aria-haspopup', 'true');
            }
        }

        // Navegação mobile
        if (UI.hamburger && UI.navbarMenu) {
            UI.hamburger.addEventListener('click', toggleMobileMenu);
            UI.hamburger.setAttribute('aria-label', 'Alternar menu');
        }

        // Sidebar
        if (UI.sidebarToggle) {
            UI.sidebarToggle.addEventListener('click', toggleSidebar);
            UI.sidebarToggle.setAttribute('aria-label', 'Alternar sidebar');
        }

        if (UI.closeSidebar) {
            UI.closeSidebar.addEventListener('click', toggleSidebar);
            UI.closeSidebar.setAttribute('aria-label', 'Fechar sidebar');
        }

        // Tema
        if (UI.themeToggle) {
            UI.themeToggle.addEventListener('click', toggleTheme);
            UI.themeToggle.setAttribute('aria-label', 
                `Alternar para tema ${STATE.theme === 'light' ? 'escuro' : 'claro'}`);
        }

        // Modal
        if (UI.feedbackBtn) {
            UI.feedbackBtn.addEventListener('click', () => toggleModal(true));
            UI.feedbackBtn.setAttribute('aria-label', 'Abrir feedback');
        }

        if (UI.closeModal) {
            UI.closeModal.addEventListener('click', () => toggleModal(false));
            UI.closeModal.setAttribute('aria-label', 'Fechar modal');
        }

        if (UI.feedbackForm) {
            UI.feedbackForm.addEventListener('submit', handleFeedbackSubmit);
        }

        // Fechar dropdown/modal quando clicar fora
        document.addEventListener('click', function(e) {
            if (UI.userDropdown && !UI.userDropdown.contains(e.target)) {
                UI.userDropdown.classList.remove('active');
                const dropdownToggle = UI.userDropdown.querySelector('.dropdown-toggle');
                if (dropdownToggle) dropdownToggle.setAttribute('aria-expanded', 'false');
            }
            
            if (UI.feedbackModal && e.target === UI.feedbackModal) {
                toggleModal(false);
            }
        });

        // Fechar com ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (UI.userDropdown && UI.userDropdown.classList.contains('active')) {
                    UI.userDropdown.classList.remove('active');
                    const dropdownToggle = UI.userDropdown.querySelector('.dropdown-toggle');
                    if (dropdownToggle) dropdownToggle.setAttribute('aria-expanded', 'false');
                }
                
                if (UI.feedbackModal && UI.feedbackModal.classList.contains('active')) {
                    toggleModal(false);
                }
                
                if (STATE.isSidebarOpen) {
                    toggleSidebar();
                }
            }
        });

        // Redimensionamento da janela
        window.addEventListener('resize', function() {
            const isMobile = window.innerWidth <= 768;
            if (STATE.isOverlayVisible !== isMobile) {
                initSidebarState();
            }
        });

        // Scroll
        window.addEventListener('scroll', handleScroll);

        // Botões de adicionar servidor
        const addServerBtns = document.querySelectorAll('#add-server-btn, #header-add-server-btn');
        addServerBtns.forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    window.open(`https://discord.com/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&scope=bot&permissions=8`, '_blank');
                });
            }
        });

        // Botão de atualizar lista de servidores
        const refreshServersBtn = document.getElementById('refresh-servers-btn');
        if (refreshServersBtn) {
            refreshServersBtn.addEventListener('click', async () => {
                refreshServersBtn.disabled = true;
                refreshServersBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
                
                try {
                    await checkAuth();
                    if (STATE.user) {
                        await updateServersUI();
                        showNotification('Lista de servidores atualizada!', 'success');
                    }
                } catch (error) {
                    console.error('Erro ao atualizar servidores:', error);
                    showNotification('Erro ao atualizar lista de servidores', 'error');
                } finally {
                    refreshServersBtn.disabled = false;
                    refreshServersBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Atualizar';
                }
            });
        }
    }

    // Mostrar/Ocultar loading (melhorado)
    function showLoading(show) {
        if (!UI.loadingOverlay) return;
        
        if (show) {
            UI.loadingOverlay.style.display = 'flex';
            setTimeout(() => {
                UI.loadingOverlay.style.opacity = '1';
            }, 10);
        } else {
            UI.loadingOverlay.style.opacity = '0';
            setTimeout(() => {
                UI.loadingOverlay.style.display = 'none';
            }, 300);
        }
    }

    // Atualizar link ativo (melhorado)
    function updateActiveLink() {
        const links = document.querySelectorAll('.navbar-links a, .sidebar-menu a');
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        
        links.forEach(link => {
            if (!link.getAttribute('href')) return;
            
            const linkPage = link.getAttribute('href').split('/').pop();
            const isActive = currentPage === linkPage || 
                (currentPage === 'index.html' && linkPage === '') ||
                (currentPage === '' && linkPage === 'index.html');
            
            link.classList.toggle('active', isActive);
            link.setAttribute('aria-current', isActive ? 'page' : null);
        });
    }

    // Gerenciamento de autenticação (totalmente atualizado)
    async function checkAuth() {
        try {
            const bootstrapRes = await fetch(`${CONFIG.API_BASE_URL}/api/bootstrap`, { credentials: 'include' });

            if (!bootstrapRes.ok) {
                if (bootstrapRes.status === 401) throw new Error('Não autorizado');
                throw new Error(`HTTP error! status: ${bootstrapRes.status}`);
            }

            const bootstrap = await bootstrapRes.json();
            const userData = bootstrap.user;
            const guildsData = bootstrap.guilds || [];
            const statsData = bootstrap.stats || null;
            const adminData = bootstrap.admin || {};

            const isAdmin = adminData.isAdmin || false;
            const isOwner = adminData.isOwner || false;

            STATE.user = userData;
            STATE.guilds = guildsData.filter(guild => guild.permissions & 0x20);
            STATE.stats = statsData;
            STATE.isAdmin = isAdmin;
            STATE.isOwner = isOwner;
            
            // Debug log
            if (isOwner || isAdmin) {
                console.log('✅ Usuário é admin/owner:', { isAdmin, isOwner, userId: userData?.id });
            }

            updateUserUI();
            await updateServersUI();
            updateStatsUI();
            updateAdminUI();

            return true;
        } catch (error) {
            console.error('Authentication check failed:', error);
            showUnauthenticatedUI();
            
            // Evita loop automático: não redireciona sozinho.
            if (error.message !== 'Não autorizado') {
                showNotification('Erro ao verificar autenticação. Tente novamente.', 'error');
            }
            
            return false;
        }
    }

    // Update admin UI (show/hide admin button in sidebar only)
    function updateAdminUI() {
        const adminSidebarItem = document.getElementById('admin-sidebar-item');
        
        if (STATE.isAdmin || STATE.isOwner) {
            if (adminSidebarItem) {
                adminSidebarItem.style.display = 'block';
            }
        } else {
            if (adminSidebarItem) {
                adminSidebarItem.style.display = 'none';
            }
        }
    }

    // Atualizar UI com dados do usuário (melhorado)
    function updateUserUI() {
        if (!STATE.user) return;

        const { id, username, discriminator, avatar, plan, badges = [] } = STATE.user;
        const avatarUrl = avatar 
            ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=256`
            : CONFIG.DEFAULT_AVATAR;

        // Atualizar avatar e nome
        if (UI.userAvatar) {
            UI.userAvatar.src = avatarUrl;
            UI.userAvatar.alt = `Avatar de ${username}`;
        }
        if (UI.navUserAvatar) {
            UI.navUserAvatar.src = avatarUrl;
            UI.navUserAvatar.alt = `Avatar de ${username}`;
        }
        if (UI.username) UI.username.textContent = username;
        if (UI.navUsername) UI.navUsername.textContent = username;
        if (UI.userDiscriminator) {
            UI.userDiscriminator.textContent = discriminator ? `#${discriminator}` : '';
        }

        // Atualizar badges (ao lado do nome)
        updateUserBadges(badges);

        // Atualizar plano
        if (UI.userPlan) {
            UI.userPlan.textContent = plan === 'premium' ? 'Premium' : 'Free';
            UI.userPlan.className = `plan-badge ${plan}`;
        }

        // Atualizar status
        updateUserStatus('online');

        // Configurar dropdown corretamente quando logado
        if (UI.userDropdown) {
            const dropdownMenu = UI.userDropdown.querySelector('.dropdown-menu');
            if (dropdownMenu) {
                // Esconder botão de login
                const loginBtn = dropdownMenu.querySelector('#login-btn');
                if (loginBtn) {
                    loginBtn.style.display = 'none';
                }
                
                // Remover botões de logout existentes
                const existingLogouts = dropdownMenu.querySelectorAll('a[href="#"]');
                existingLogouts.forEach(btn => {
                    if (btn.querySelector('.fa-sign-out-alt')) {
                        btn.remove();
                    }
                });
                
                // Adicionar apenas um botão de logout funcional
                const logoutBtn = document.createElement('a');
                logoutBtn.href = '#';
                logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sair';
                logoutBtn.onclick = (e) => {
                    e.preventDefault();
                    logout();
                };
                dropdownMenu.appendChild(logoutBtn);
            }
        }
    }

    // Atualizar badges do usuário (ao lado do nome)
    function updateUserBadges(badges) {
        const badgesContainer = document.getElementById('userBadgesInline');
        if (!badgesContainer) return;

        if (!badges || badges.length === 0) {
            badgesContainer.innerHTML = '';
            return;
        }

        badgesContainer.innerHTML = badges.map(badge => {
            // Se tiver imageUrl, usa imagem, senão usa ícone fallback
            // Removido title para evitar tooltip padrão do navegador
            if (badge.imageUrl) {
                return `
                    <div class="discord-badge">
                        <img src="${badge.imageUrl}" alt="${badge.name}" class="badge-image" 
                             onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling && (this.nextElementSibling.style.display='inline');">
                        ${badge.fallbackIcon ? `<span class="badge-icon" style="display:none;">${badge.fallbackIcon}</span>` : ''}
                        <span class="badge-tooltip">${badge.description || badge.name}</span>
                    </div>
                `;
            } else if (badge.icon || badge.fallbackIcon) {
                return `
                    <div class="discord-badge">
                        <span class="badge-icon">${badge.icon || badge.fallbackIcon || ''}</span>
                        <span class="badge-tooltip">${badge.description || badge.name}</span>
                    </div>
                `;
            }
            return '';
        }).join('');
    }

    // Atualizar status do usuário (mantido)
    function updateUserStatus(status) {
        const statusMap = {
            online: { color: 'var(--online-color)', text: 'Online' },
            idle: { color: 'var(--idle-color)', text: 'Ausente' },
            dnd: { color: 'var(--dnd-color)', text: 'Ocupado' },
            offline: { color: 'var(--offline-color)', text: 'Offline' }
        };

        const currentStatus = statusMap[status] || statusMap.offline;

        if (UI.statusDot) {
            UI.statusDot.style.backgroundColor = currentStatus.color;
            UI.statusDot.className = 'status-dot ' + status;
            UI.statusDot.setAttribute('aria-label', `Status: ${currentStatus.text}`);
        }
        if (UI.statusText) UI.statusText.textContent = currentStatus.text;
    }

    // Atualizar UI dos servidores (melhorado com dados reais)
    async function updateServersUI() {
        if (!UI.serversGrid) return;

        UI.serversGrid.innerHTML = '';
        
        if (!STATE.guilds || STATE.guilds.length === 0) {
            UI.serversGrid.innerHTML = `
                <div class="server-card placeholder">
                    <div class="server-icon" aria-hidden="true">
                        <i class="fas fa-server"></i>
                    </div>
                    <h3>Nenhum servidor encontrado</h3>
                    <p>Você não possui servidores ou não tem permissão para gerenciá-los</p>
                </div>
            `;
            return;
        }

        if (UI.serverCount) {
            animateCounter(UI.serverCount, 0, STATE.guilds.length, 1000);
        }

        // Fetch server stats and bot presence for all guilds
        const serverDataPromises = STATE.guilds.map(async guild => {
            const [statsRes, botPresentRes] = await Promise.all([
                fetch(`${CONFIG.API_BASE_URL}/api/server/${guild.id}/stats?t=${Date.now()}`, { 
                    credentials: 'include',
                    cache: 'no-cache',
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                }).then(res => res.ok ? res.json() : null).catch(() => null),
                fetch(`${CONFIG.API_BASE_URL}/api/server/${guild.id}/bot-present`, { 
                    credentials: 'include',
                    cache: 'no-cache'
                }).then(res => res.ok ? res.json() : null).catch(() => ({ present: false }))
            ]);
            
            return {
                stats: statsRes || {},
                botPresent: botPresentRes?.present ?? false
            };
        });

        const serverData = await Promise.all(serverDataPromises);

        STATE.guilds.forEach((guild, index) => {
            const { stats, botPresent } = serverData[index] || { stats: {}, botPresent: false };
            const serverCard = document.createElement('div');
            serverCard.className = 'server-card';
            serverCard.dataset.guildId = guild.id;
            serverCard.setAttribute('role', 'button');
            serverCard.setAttribute('aria-label', botPresent ? `Gerenciar servidor ${guild.name}` : `Convidar bot para ${guild.name}`);
            
            const icon = guild.icon 
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
                : guild.name.charAt(0);
            
            // Show different content based on bot presence
            const buttonHTML = botPresent 
                ? `<button class="btn secondary-btn small-btn manage-btn" aria-label="Gerenciar ${guild.name}">
                    <i class="fas fa-cog"></i> Configurar
                </button>`
                : '';
            
            const statsHTML = botPresent 
                ? `<div class="server-stats">
                    <p><i class="fas fa-terminal"></i> Prefixo: <strong>${stats.prefix || '!'}</strong></p>
                    <p><i class="fas fa-chart-line"></i> Comandos: <strong>${stats.commandsExecuted || 0}</strong></p>
                    <p><i class="fas fa-users"></i> Usuários únicos: <strong>${stats.uniqueUsers || 0}</strong></p>
                </div>`
                : `<div class="server-stats bot-not-present">
                    <p><i class="fas fa-exclamation-triangle"></i> <strong>Bot não está no servidor</strong></p>
                    <p>Adicione o bot ao servidor para começar a usar os recursos</p>
                </div>`;
            
            // Create server icon with proper error handling
            let iconHTML = '';
            if (guild.icon) {
                const iconUrl = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
                iconHTML = `<img src="${iconUrl}" alt="${guild.name}" loading="lazy" onerror="this.onerror=null; this.style.display='none'; const parent = this.parentElement; parent.innerHTML='${guild.name.charAt(0).replace(/'/g, "\\'")}'; parent.style.backgroundColor='var(--primary-dark)'; parent.style.color='white'; parent.style.fontSize='2rem'; parent.style.fontWeight='600'; parent.style.display='flex'; parent.style.alignItems='center'; parent.style.justifyContent='center';" />`;
            } else {
                iconHTML = guild.name.charAt(0);
            }
            
            serverCard.innerHTML = `
                <div class="server-icon">
                    ${iconHTML}
                </div>
                <h3>${guild.name}</h3>
                ${statsHTML}
                ${buttonHTML}
            `;
            
            UI.serversGrid.appendChild(serverCard);
            
            // Add click handler to the button (only if bot is present)
            if (botPresent) {
                const manageBtn = serverCard.querySelector('.manage-btn');
                if (manageBtn) {
                    manageBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        window.location.href = `/server/${guild.id}`;
                    });
                }
            }
        });
    }

    // Atualizar estatísticas na UI (melhorado)
    function updateStatsUI() {
        if (!STATE.stats) return;

        if (UI.commandCount) {
            animateCounter(UI.commandCount, 0, STATE.stats.commands_24h, 1500);
        }

        if (UI.userCount) {
            animateCounter(UI.userCount, 0, STATE.stats.unique_users, 1500);
        }

        if (UI.uptimePercent) {
            UI.uptimePercent.textContent = STATE.stats.uptime + '%';
        }

        updateCharts();
    }

    // Animação de contador (mantido)
    function animateCounter(element, start, end, duration) {
        if (!element) return;
        
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const value = Math.floor(progress * (end - start) + start);
            element.textContent = value.toLocaleString();
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    // Inicializar gráficos (melhorado)
    function initCharts() {
        const activityCtx = document.getElementById('activityChart')?.getContext('2d');
        const commandsCtx = document.getElementById('commandsChart')?.getContext('2d');

        if (activityCtx) {
            STATE.charts.activity = new Chart(activityCtx, {
                type: 'line',
                data: {
                    labels: Array(24).fill().map((_, i) => `${i}h`),
                    datasets: [{
                        label: 'Comandos por hora',
                        data: Array(24).fill().map(() => Math.floor(Math.random() * 1000)),
                        borderColor: 'var(--primary-color)',
                        backgroundColor: 'rgba(138, 79, 255, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: getChartOptions('Atividade nas últimas 24 horas')
            });
        }

        if (commandsCtx) {
            STATE.charts.commands = new Chart(commandsCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Moderação', 'Diversão', 'Utilitários', 'Música', 'Outros'],
                    datasets: [{
                        data: [35, 25, 20, 15, 5],
                        backgroundColor: [
                            'var(--primary-color)',
                            'var(--secondary-color)',
                            'var(--accent-color)',
                            'var(--primary-dark)',
                            'var(--border-color)'
                        ],
                        borderWidth: 0
                    }]
                },
                options: getChartOptions('Distribuição de comandos')
            });
        }
    }

    // Atualizar gráficos com dados reais (melhorado)
    function updateCharts() {
        if (!STATE.stats) return;

        if (STATE.charts.activity) {
            STATE.charts.activity.data.datasets[0].data = STATE.stats.commands_by_hour || 
                Array(24).fill().map((_, i) => Math.floor(Math.random() * 1000));
            STATE.charts.activity.update();
        }

        if (STATE.charts.commands) {
            STATE.charts.commands.data.datasets[0].data = [
                STATE.stats.command_categories?.moderation || 35,
                STATE.stats.command_categories?.fun || 25,
                STATE.stats.command_categories?.utility || 20,
                STATE.stats.command_categories?.music || 15,
                STATE.stats.command_categories?.other || 5
            ];
            STATE.charts.commands.update();
        }
    }

    // Opções padrão para gráficos (mantido)
    function getChartOptions(title) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-color')
                    }
                },
                title: {
                    display: !!title,
                    text: title,
                    color: getComputedStyle(document.documentElement).getPropertyValue('--text-color'),
                    font: {
                        size: 14
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--border-color')
                    },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-light')
                    }
                },
                x: {
                    grid: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--border-color')
                    },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-light')
                    }
                }
            }
        };
    }

    // Mostrar UI para usuários não autenticados (melhorado)
    function showUnauthenticatedUI() {
        // Configurar dropdown quando não logado
        if (UI.userDropdown) {
            const dropdownMenu = UI.userDropdown.querySelector('.dropdown-menu');
            if (dropdownMenu) {
                // Mostrar botão de login
                const loginBtn = dropdownMenu.querySelector('#login-btn');
                if (loginBtn) {
                    loginBtn.style.display = 'block';
                    loginBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.location.href = `${CONFIG.API_BASE_URL}/auth/discord`;
                    };
                }
                
                // Remover todos os botões de logout
                const allLinks = dropdownMenu.querySelectorAll('a');
                allLinks.forEach(link => {
                    if (link.querySelector('.fa-sign-out-alt')) {
                        link.remove();
                    }
                });
            }
        }
        
        if (UI.userAvatar) {
            UI.userAvatar.src = CONFIG.DEFAULT_AVATAR;
            UI.userAvatar.alt = 'Avatar padrão';
        }
        if (UI.navUserAvatar) {
            UI.navUserAvatar.src = CONFIG.DEFAULT_AVATAR;
            UI.navUserAvatar.alt = 'Avatar padrão';
        }
        if (UI.username) UI.username.textContent = 'Não Logado';
        if (UI.navUsername) UI.navUsername.textContent = 'Entrar';
        if (UI.userDiscriminator) UI.userDiscriminator.textContent = '#0000';
        updateUserStatus('offline');
        if (UI.userPlan) {
            UI.userPlan.textContent = 'Free';
            UI.userPlan.className = 'plan-badge free';
        }

        if (UI.loginBtn) {
            UI.loginBtn.innerHTML = '<i class="fab fa-discord"></i> Login com Discord';
            UI.loginBtn.onclick = handleAuthClick;
            UI.loginBtn.setAttribute('aria-label', 'Login com Discord');
        }

        if (UI.serversGrid) {
            UI.serversGrid.innerHTML = `
                <div class="server-card placeholder">
                    <div class="server-icon" aria-hidden="true">
                        <i class="fas fa-sign-in-alt"></i>
                    </div>
                    <h3>Faça login</h3>
                    <p>Conecte-se com Discord para gerenciar seus servidores</p>
                    <button class="btn primary-btn small-btn" id="grid-login-btn" aria-label="Login com Discord">
                        <i class="fab fa-discord"></i> Login com Discord
                    </button>
                </div>
            `;

            const gridLoginBtn = document.getElementById('grid-login-btn');
            if (gridLoginBtn) {
                gridLoginBtn.addEventListener('click', handleAuthClick);
            }
        }

        if (UI.serverCount) UI.serverCount.textContent = '0';
        if (UI.commandCount) UI.commandCount.textContent = '0';
        if (UI.userCount) UI.userCount.textContent = '0';
    }

    // Manipulador de autenticação (melhorado)
    function handleAuthClick() {
        if (STATE.user) {
            logout();
        } else {
            window.location.href = `${CONFIG.API_BASE_URL}/auth/discord`;
        }
    }

    // Logout (melhorado)
    async function logout() {
        try {
            await fetch(`${CONFIG.API_BASE_URL}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
            
            STATE.user = null;
            STATE.guilds = [];
            STATE.stats = null;
            
            if (STATE.charts.activity) STATE.charts.activity.destroy();
            if (STATE.charts.commands) STATE.charts.commands.destroy();
            
            showUnauthenticatedUI();
            showNotification('Você saiu da sua conta', 'info');
            
            // Redireciona apenas se não estiver na página inicial
            if (!window.location.pathname.endsWith('index.html')) {
                window.location.href = '/';
            }
        } catch (error) {
            console.error('Logout error:', error);
            showNotification('Erro ao sair. Tente novamente.', 'error');
        }
    }

    // Alternar menu mobile (melhorado)
    function toggleMobileMenu() {
        STATE.isMobileMenuOpen = !STATE.isMobileMenuOpen;
        
        if (UI.navbarMenu) {
            UI.navbarMenu.classList.toggle('active');
        }
        
        if (UI.hamburger) {
            UI.hamburger.classList.toggle('active');
            UI.hamburger.setAttribute('aria-expanded', STATE.isMobileMenuOpen);
            
            const icon = UI.hamburger.querySelector('i');
            if (icon) {
                icon.className = STATE.isMobileMenuOpen ? 'fas fa-times' : 'fas fa-bars';
            }
        }
        
        document.body.style.overflow = STATE.isMobileMenuOpen ? 'hidden' : '';
    }

    // Alternar modal (melhorado)
    function toggleModal(show) {
        if (!UI.feedbackModal) return;
        
        if (show) {
            UI.feedbackModal.classList.add('active');
            document.body.style.overflow = 'hidden';
            UI.feedbackModal.setAttribute('aria-hidden', 'false');
        } else {
            UI.feedbackModal.classList.remove('active');
            document.body.style.overflow = '';
            UI.feedbackModal.setAttribute('aria-hidden', 'true');
        }
    }

    // Enviar feedback (melhorado)
    async function handleFeedbackSubmit(e) {
        e.preventDefault();
        
        const formData = {
            type: document.getElementById('feedbackType').value,
            message: document.getElementById('feedbackMessage').value.trim()
        };

        if (!formData.message) {
            showNotification('Por favor, insira uma mensagem de feedback', 'error');
            document.getElementById('feedbackMessage').focus();
            return;
        }

        showLoading(true);
        
        try {
            // Simulação de envio (substitua por chamada real à API)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            toggleModal(false);
            showNotification('Feedback enviado com sucesso! Obrigado.', 'success');
            UI.feedbackForm.reset();
        } catch (error) {
            console.error('Error submitting feedback:', error);
            showNotification('Erro ao enviar feedback. Tente novamente.', 'error');
        } finally {
            showLoading(false);
        }
    }

    // Atualizar relógio (mantido)
    function updateClock() {
        if (!UI.currentTime) return;
        
        const now = new Date();
        const timeString = now.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
        
        const dateString = now.toLocaleDateString('pt-BR', { 
            weekday: 'short', 
            day: 'numeric', 
            month: 'short' 
        }).replace('.', '');
        
        UI.currentTime.textContent = `${dateString} • ${timeString}`;
        UI.currentTime.setAttribute('aria-label', `Data e hora atual: ${dateString} às ${timeString}`);
    }

    // Alternar tema (melhorado)
    function toggleTheme() {
        STATE.theme = STATE.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem(CONFIG.THEME_KEY, STATE.theme);
        applyTheme();
    }

    // Aplicar tema (melhorado)
    function applyTheme() {
        document.documentElement.setAttribute('data-theme', STATE.theme);
        
        if (UI.themeIcon) {
            UI.themeIcon.className = STATE.theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
            UI.themeIcon.setAttribute('aria-label', 
                `Tema ${STATE.theme === 'light' ? 'claro' : 'escuro'}`);
        }

        showNotification(`Tema ${STATE.theme === 'light' ? 'claro' : 'escuro'} ativado`);
    }

    // Mostrar notificação (melhorado)
    function showNotification(message, type = 'info') {
        const types = {
            success: { icon: 'check-circle', color: '#2ecc71' },
            error: { icon: 'exclamation-triangle', color: '#e74c3c' },
            info: { icon: 'info-circle', color: '#3498db' },
            warning: { icon: 'exclamation-circle', color: '#f39c12' }
        };

        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.setAttribute('role', 'alert');
        notification.setAttribute('aria-live', 'assertive');
        notification.innerHTML = `
            <i class="fas fa-${types[type]?.icon || 'info-circle'}" aria-hidden="true"></i>
            <span>${message}</span>
        `;
        notification.style.backgroundColor = types[type]?.color || '#3498db';

        document.body.appendChild(notification);

        // Animação de entrada
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Remover após 5 segundos
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 5000);
    }

    // Lidar com scroll da página (melhorado)
    function handleScroll() {
        const currentScrollPosition = window.pageYOffset;

        // Mostrar/ocultar botão "voltar ao topo"
        if (UI.backToTop) {
            if (currentScrollPosition > 300) {
                UI.backToTop.classList.add('visible');
            } else {
                UI.backToTop.classList.remove('visible');
            }
        }

        STATE.lastScrollPosition = currentScrollPosition;
    }

    // Gerenciar servidor (redirect to config page)
    async function manageServer(guildId, guildName) {
        window.location.href = `/server/${guildId}`;
    }

    // Mostrar modal de configuração do servidor
    function showServerConfigModal(guildId, guildName, config) {
        console.log('🎨 showServerConfigModal chamado:', guildId, guildName, config);
        
        if (!guildId || !guildName || !config) {
            console.error('❌ Parâmetros inválidos para modal');
            showNotification('Erro: Dados inválidos para abrir configurações', 'error');
            return;
        }
        
        // Remove existing modal if any
        const existingModal = document.querySelector('.modal, #server-config-modal');
        if (existingModal) {
            console.log('🗑️ Removendo modal existente');
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'server-config-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', 'modal-title');
        modal.setAttribute('aria-modal', 'true');
        modal.style.display = 'flex';
        
        const stats = config.stats || {};
        // Handle uniqueUsers - can be number (from API) or Set (from config)
        let uniqueUsersCount = 0;
        if (typeof stats.uniqueUsers === 'number') {
            uniqueUsersCount = stats.uniqueUsers;
        } else if (stats.uniqueUsers?.size !== undefined) {
            uniqueUsersCount = stats.uniqueUsers.size;
        } else {
            uniqueUsersCount = 0;
        }
        
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 id="modal-title">
                        <i class="fas fa-cog"></i> Configurar ${escapeHtml(guildName)}
                    </h3>
                    <button class="close-modal" aria-label="Fechar modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="server-prefix">
                            <i class="fas fa-terminal"></i> Prefixo dos Comandos
                        </label>
                        <input 
                            type="text" 
                            id="server-prefix" 
                            value="${escapeHtml(config.prefix || '!')}" 
                            maxlength="5" 
                            placeholder="!"
                            class="form-input"
                        >
                        <small>O prefixo usado para comandos de texto (ex: !help, $help)</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="server-nickname">
                            <i class="fas fa-user-tag"></i> Apelido do Bot
                        </label>
                        <input 
                            type="text" 
                            id="server-nickname" 
                            value="${escapeHtml(config.nickname || '')}" 
                            maxlength="32" 
                            placeholder="Deixe vazio para usar nome padrão"
                            class="form-input"
                        >
                        <small>O apelido que o bot terá neste servidor (máx. 32 caracteres)</small>
                    </div>
                    
                    <div class="form-group">
                        <label>Módulos Ativados</label>
                        <div class="module-toggle">
                            <label class="toggle-item">
                                <input 
                                    type="checkbox" 
                                    ${config.modules?.moderation !== false ? 'checked' : ''} 
                                    data-module="moderation"
                                >
                                <span>
                                    <i class="fas fa-shield-alt"></i> 
                                    <strong>Moderação</strong>
                                    <small>Comandos de moderação e segurança</small>
                                </span>
                            </label>
                            <label class="toggle-item">
                                <input 
                                    type="checkbox" 
                                    ${config.modules?.fun !== false ? 'checked' : ''} 
                                    data-module="fun"
                                >
                                <span>
                                    <i class="fas fa-gamepad"></i> 
                                    <strong>Diversão</strong>
                                    <small>Comandos de entretenimento</small>
                                </span>
                            </label>
                            <label class="toggle-item">
                                <input 
                                    type="checkbox" 
                                    ${config.modules?.utility !== false ? 'checked' : ''} 
                                    data-module="utility"
                                >
                                <span>
                                    <i class="fas fa-toolbox"></i> 
                                    <strong>Utilidades</strong>
                                    <small>Comandos úteis e informativos</small>
                                </span>
                            </label>
                            <label class="toggle-item">
                                <input 
                                    type="checkbox" 
                                    ${config.modules?.music ? 'checked' : ''} 
                                    data-module="music"
                                >
                                <span>
                                    <i class="fas fa-music"></i> 
                                    <strong>Música</strong>
                                    <small>Comandos de música e áudio</small>
                                </span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="server-stats-preview">
                        <h4><i class="fas fa-chart-bar"></i> Estatísticas do Servidor</h4>
                        <div class="stats-grid">
                            <div class="stat-item">
                                <span class="stat-label">
                                    <i class="fas fa-terminal"></i> Comandos executados
                                </span>
                                <span class="stat-value">${stats.commandsExecuted || 0}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">
                                    <i class="fas fa-users"></i> Usuários únicos
                                </span>
                                <span class="stat-value">${uniqueUsersCount}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">
                                    <i class="fas fa-clock"></i> Último comando
                                </span>
                                <span class="stat-value">
                                    ${stats.lastCommandTime 
                                        ? new Date(stats.lastCommandTime).toLocaleDateString('pt-BR')
                                        : 'Nunca'}
                                </span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">
                                    <i class="fas fa-list"></i> Categorias
                                </span>
                                <span class="stat-value">
                                    ${Object.values(stats.commandsByCategory || {}).reduce((a, b) => a + b, 0) || 0}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="modal-actions">
                        <button class="btn secondary-btn" id="cancel-config">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        <button class="btn primary-btn" id="save-server-config">
                            <i class="fas fa-save"></i> Salvar Configurações
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        console.log('✅ Modal adicionado ao DOM');
        
        // Force reflow and add active class
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.classList.add('active');
                console.log('✅ Modal ativado com classe active');
            });
        });
        
        // Focus trap
        const firstFocusable = modal.querySelector('#server-prefix');
        const lastFocusable = modal.querySelector('#save-server-config');
        
        // Close modal handlers
        const closeModal = () => {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.remove();
                document.removeEventListener('keydown', handleEsc);
            }, 300);
        };
        
        const closeBtn = modal.querySelector('.close-modal');
        const cancelBtn = modal.querySelector('#cancel-config');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeModal);
        }
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        // ESC key to close
        const handleEsc = (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeModal();
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        // Save configuration
        const saveBtn = modal.querySelector('#save-server-config');
        saveBtn.addEventListener('click', async () => {
            const prefixInput = modal.querySelector('#server-prefix');
            const nicknameInput = modal.querySelector('#server-nickname');
            const prefix = prefixInput.value.trim();
            const nickname = nicknameInput.value.trim();
            
            if (!prefix || prefix.length === 0) {
                showNotification('O prefixo não pode estar vazio!', 'error');
                prefixInput.focus();
                return;
            }
            
            if (prefix.length > 5) {
                showNotification('O prefixo não pode ter mais de 5 caracteres!', 'error');
                prefixInput.focus();
                return;
            }
            
            if (nickname.length > 32) {
                showNotification('O apelido não pode ter mais de 32 caracteres!', 'error');
                nicknameInput.focus();
                return;
            }
            
            const modules = {};
            modal.querySelectorAll('[data-module]').forEach(checkbox => {
                modules[checkbox.dataset.module] = checkbox.checked;
            });
            
            // Disable save button during request
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
            
            try {
                // Save prefix
                const prefixRes = await fetch(`${CONFIG.API_BASE_URL}/api/server/${guildId}/prefix`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ prefix })
                });
                
                if (!prefixRes.ok) {
                    const error = await prefixRes.json();
                    throw new Error(error.error || 'Erro ao salvar prefixo');
                }
                
                // Save nickname
                const nicknameRes = await fetch(`${CONFIG.API_BASE_URL}/api/server/${guildId}/nickname`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ nickname: nickname || null })
                });
                
                if (!nicknameRes.ok) {
                    const error = await nicknameRes.json();
                    throw new Error(error.error || 'Erro ao salvar apelido');
                }
                
                // Save modules
                const modulePromises = Object.entries(modules).map(([module, enabled]) =>
                    fetch(`${CONFIG.API_BASE_URL}/api/server/${guildId}/module`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ module, enabled })
                    })
                );
                
                await Promise.all(modulePromises);
                
                showNotification('✅ Configurações salvas com sucesso!', 'success');
                closeModal();
                
                // Small delay to ensure data is saved
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Refresh servers UI to show updated data
                await updateServersUI();
            } catch (error) {
                console.error('Erro ao salvar configuração:', error);
                showNotification(`❌ ${error.message || 'Erro ao salvar configurações'}`, 'error');
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Salvar Configurações';
            }
        });
        
        // Focus first input
        setTimeout(() => firstFocusable?.focus(), 100);
    }
    
    // Helper function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Visualizar detalhes do servidor
    async function viewServerDetails(guildId) {
        // Open configuration modal instead of just logging
        console.log(`📋 Abrindo configurações do servidor ${guildId}`);
        
        // Find the guild name from STATE
        const guild = STATE.guilds?.find(g => g.id === guildId);
        if (guild) {
            // Open configuration modal
            await manageServer(guildId, guild.name);
        } else {
            console.warn('Servidor não encontrado no estado:', guildId);
            showNotification('Servidor não encontrado', 'error');
        }
    }

    // Inicializar a aplicação
    init();
});
