/**
 * Main Application Script - Holly Discord Bot
 * Version: 2.4.7
 * Author: Zppolar
 * Date: 2023
 */

document.addEventListener('DOMContentLoaded', function() {
    // Configurações da aplicação
    const CONFIG = {
        THEME_KEY: 'holly_theme',
        DECORATIVE_ELEMENTS: 12,
        FLOATING_ANIMATION_DURATION: 1000,
        SCROLL_THRESHOLD: 300
    };

    // Elementos da UI
    const UI = {
        // Navegação
        hamburger: document.getElementById('hamburger'),
        navbarLinks: document.getElementById('navbarLinks'),
        
        // Tema
        themeToggle: document.querySelector('.theme-toggle'),
        themeIcon: document.getElementById('themeIcon'),
        
        // Rodapé
        currentYear: document.getElementById('current-year'),
        
        // Cards de recursos
        featureCards: document.querySelectorAll('.feature-card'),
        
        // Botão de voltar ao topo
        backToTop: document.getElementById('backToTop'),
        
        // Hero section
        heroSection: document.querySelector('.hero'),
        
        // Seletor de idioma
        languageSelector: document.getElementById('language-selector')
    };

    // Estado da aplicação
    const STATE = {
        currentTheme: localStorage.getItem(CONFIG.THEME_KEY) || 'light',
        isMobileMenuOpen: false,
        lastScrollPosition: 0
    };

    // Inicialização
    function init() {
        setupEventListeners();
        setCurrentYear();
        setupFeatureCards();
        addDecorativeElements();
        setupBackToTop();
        applyTheme();
        setupLanguageSelector();
    }

    // Configurar event listeners
    function setupEventListeners() {
        // Menu mobile
        if (UI.hamburger && UI.navbarLinks) {
            UI.hamburger.addEventListener('click', toggleMobileMenu);
        }

        // Alternador de tema
        if (UI.themeToggle) {
            UI.themeToggle.addEventListener('click', toggleTheme);
        }

        // Scroll event para o botão "voltar ao topo"
        window.addEventListener('scroll', handleScroll);

        // Fechar menu mobile ao clicar em um link
        if (UI.navbarLinks) {
            UI.navbarLinks.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', closeMobileMenu);
            });
        }

        // Redimensionamento da janela
        window.addEventListener('resize', handleResize);
    }

    // Configurar seletor de idioma
    function setupLanguageSelector() {
        if (UI.languageSelector) {
            UI.languageSelector.addEventListener('change', function() {
                // Em uma aplicação real, isso mudaria o idioma
                console.log('Idioma selecionado:', this.value);
                showNotification(`Idioma alterado para ${this.options[this.selectedIndex].text}`, 'success');
            });
        }
    }

    // Alternar menu mobile
    function toggleMobileMenu() {
        STATE.isMobileMenuOpen = !STATE.isMobileMenuOpen;
        UI.navbarLinks.classList.toggle('active');
        UI.hamburger.classList.toggle('active');
        
        // Alternar ícone do hamburger
        const icon = UI.hamburger.querySelector('i');
        if (icon) {
            icon.className = STATE.isMobileMenuOpen ? 'fas fa-times' : 'fas fa-bars';
        }
        
        // Bloquear scroll do body quando o menu estiver aberto
        document.body.style.overflow = STATE.isMobileMenuOpen ? 'hidden' : '';
    }

    // Fechar menu mobile
    function closeMobileMenu() {
        if (STATE.isMobileMenuOpen) {
            toggleMobileMenu();
        }
    }

    // Lidar com redimensionamento da janela
    function handleResize() {
        // Fechar menu mobile se a tela for maior que mobile
        if (window.innerWidth > 768 && STATE.isMobileMenuOpen) {
            closeMobileMenu();
        }
    }

    // Definir ano atual no rodapé
    function setCurrentYear() {
        if (UI.currentYear) {
            UI.currentYear.textContent = new Date().getFullYear();
        }
    }

    // Configurar cards de recursos
    function setupFeatureCards() {
        UI.featureCards.forEach(card => {
            // Efeito hover
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-10px)';
                card.style.boxShadow = '0 15px 30px rgba(0,0,0,0.1)';
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                card.style.boxShadow = '';
            });

            // Animar ao aparecer na tela
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('animate');
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1 });

            observer.observe(card);
        });
    }

    // Adicionar elementos decorativos
    function addDecorativeElements() {
        if (!UI.heroSection) return;

        const types = ['heart', 'star', 'circle', 'square', 'music'];
        const colors = ['#ff9ff3', '#feca57', '#54a0ff', '#5f27cd', '#7effdb', '#ff6b6b'];
        
        for (let i = 0; i < CONFIG.DECORATIVE_ELEMENTS; i++) {
            const element = document.createElement('i');
            const type = types[Math.floor(Math.random() * types.length)];
            const color = colors[Math.floor(Math.random() * colors.length)];
            
            element.className = `fas fa-${type} decorative`;
            element.style.color = color;
            element.style.fontSize = `${Math.random() * 1 + 0.8}rem`;
            element.style.top = `${Math.random() * 80 + 10}%`;
            element.style.left = `${Math.random() * 80 + 10}%`;
            element.style.animationDuration = `${Math.random() * 3 + 2}s`;
            element.style.opacity = '0.3';
            element.style.position = 'absolute';
            element.style.zIndex = '0';
            element.style.pointerEvents = 'none';
            
            // Animação aleatória
            const animationType = Math.random() > 0.5 ? 'float' : 'pulse';
            element.style.animationName = animationType;
            
            UI.heroSection.appendChild(element);
        }
    }

    // Configurar botão "voltar ao topo"
    function setupBackToTop() {
        if (!UI.backToTop) return;

        UI.backToTop.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }

    // Lidar com scroll da página
    function handleScroll() {
        const currentScrollPosition = window.pageYOffset;

        // Mostrar/ocultar botão "voltar ao topo"
        if (UI.backToTop) {
            if (currentScrollPosition > CONFIG.SCROLL_THRESHOLD) {
                UI.backToTop.classList.add('visible');
            } else {
                UI.backToTop.classList.remove('visible');
            }
        }

        // Efeito de parallax básico
        if (UI.heroSection) {
            const heroContent = UI.heroSection.querySelector('.hero-content');
            if (heroContent) {
                const scrollValue = currentScrollPosition * 0.3;
                heroContent.style.transform = `translateY(${scrollValue}px)`;
            }
        }

        STATE.lastScrollPosition = currentScrollPosition;
    }

    // Alternar tema
    function toggleTheme() {
        STATE.currentTheme = STATE.currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem(CONFIG.THEME_KEY, STATE.currentTheme);
        applyTheme();
    }

    // Aplicar tema
    function applyTheme() {
        document.documentElement.setAttribute('data-theme', STATE.currentTheme);
        
        if (UI.themeIcon) {
            UI.themeIcon.className = STATE.currentTheme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }

        showNotification(`Tema ${STATE.currentTheme === 'light' ? 'claro' : 'escuro'} ativado`);
    }

    // Mostrar notificação
    function showNotification(message, type = 'info') {
        const types = {
            success: { icon: 'check-circle', color: '#2ecc71' },
            error: { icon: 'exclamation-triangle', color: '#e74c3c' },
            info: { icon: 'info-circle', color: '#3498db' }
        };

        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.innerHTML = `
            <i class="fas fa-${types[type].icon}"></i>
            <span>${message}</span>
        `;
        notification.style.backgroundColor = types[type].color;

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

    // Inicializar a aplicação
    init();

    // Mock data para desenvolvimento
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.log('Running in development mode');
        
        // Exemplo: Simular carregamento de dados
        setTimeout(() => {
            if (document.getElementById('serverCount')) {
                animateCounter(document.getElementById('serverCount'), 0, 2500, 2000);
            }
            if (document.getElementById('userCount')) {
                animateCounter(document.getElementById('userCount'), 0, 1000000, 2000);
            }
            if (document.getElementById('commandCount')) {
                animateCounter(document.getElementById('commandCount'), 0, 100, 1000);
            }
        }, 1500);
    }

    // Função para animar contadores
    function animateCounter(element, start, end, duration) {
        if (!element) return;
        
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const value = Math.floor(progress * (end - start) + start);
            element.textContent = value.toLocaleString() + (progress === 1 && end === 100 ? '+' : '');
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }
});

// Definir animações CSS dinamicamente
const style = document.createElement('style');
style.textContent = `
    @keyframes float {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-20px) rotate(5deg); }
    }
    
    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 0.3; }
        50% { transform: scale(1.2); opacity: 0.6; }
    }
    
    .notification {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 15px 25px;
        border-radius: 8px;
        color: white;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 1000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .notification.show {
        transform: translateX(0);
    }
    
    .back-to-top {
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background-color: var(--primary-color);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        z-index: 999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    
    .back-to-top.visible {
        opacity: 1;
        visibility: visible;
    }
    
    .back-to-top:hover {
        background-color: var(--primary-dark);
        transform: translateY(-5px);
    }
`;
document.head.appendChild(style);