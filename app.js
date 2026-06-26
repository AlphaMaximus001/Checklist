/* ==========================================================================
   AuraList — Application logic with Supabase sync and retro features
   ========================================================================== */

// --- IndexedDB Offline Manager (Reused from local version) ---
class LocalDatabaseManager {
    constructor() {
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('AuraListLocalDB', 2);
            request.onerror = (e) => reject(e);
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('tasks')) {
                    db.createObjectStore('tasks', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('categories')) {
                    db.createObjectStore('categories', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    async save(storeName, data) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            transaction.objectStore(storeName).put(data);
            transaction.oncomplete = () => resolve(true);
        });
    }

    async get(storeName, key) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const request = transaction.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result);
        });
    }

    async delete(storeName, key) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            transaction.objectStore(storeName).delete(key);
            transaction.oncomplete = () => resolve();
        });
    }

    async getAll(storeName) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const request = transaction.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result || []);
        });
    }

    async clearAll() {
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['tasks', 'categories', 'settings'], 'readwrite');
            transaction.objectStore('tasks').clear();
            transaction.objectStore('categories').clear();
            transaction.objectStore('settings').clear();
            transaction.oncomplete = () => resolve();
        });
    }
}

// --- Sound Synthesizer Class (Mechanical SFX) ---
class RetroSynthesizer {
    constructor() {
        this.ctx = null;
    }

    lazyInit() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playClick() {
        this.lazyInit();
        if (!this.ctx) return;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.05);
        
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.06);
    }

    playChime() {
        this.lazyInit();
        if (!this.ctx) return;
        
        const now = this.ctx.currentTime;
        
        // Note 1: C5
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(523.25, now);
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);
        
        // Note 2: E5 (played slightly later)
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now + 0.08);
        gain2.gain.setValueAtTime(0.15, now + 0.08);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.2);
        
        osc2.start(now + 0.08);
        osc2.stop(now + 0.3);
    }
}

// --- AuraList Application Engine ---
class AuraListApp {
    constructor() {
        this.localDb = new LocalDatabaseManager();
        this.sfx = new RetroSynthesizer();
        this.supabase = null;
        this.user = null;
        
        // App State
        this.tasks = [];
        this.categories = [];
        this.activeCategory = 'all';
        this.searchQuery = '';
        this.filterPriority = 'all';
        this.filterStatus = 'all';
        this.sortBy = 'custom';
        this.activeTheme = 'theme-cyan';

        // Lightbox Zoom States
        this.isFitMode = true;
        this.zoomScale = 1.0;

        // Inline Preview Zoom States
        this.isInlineFitMode = true;
        this.inlineZoomScale = 1.0;

        // Modal Temporary States
        this.modalScreenshots = []; // Holds Base64 DataURLs or Cloud URLs
        this.modalVoiceNote = null; // Base64 DataURL or Cloud URL
        
        // Recording States
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingTimerInterval = null;
        this.recordingSeconds = 0;
        
        // Custom Audio Players (Winamp style)
        this.activeAudioElement = null;
        this.audioPlayInterval = null;
        this.visualizerInterval = null;
    }

    async initialize() {
        // 1. Init Local IndexedDB Database
        await this.localDb.init();

        // 2. Fetch Theme setting
        const savedTheme = await this.localDb.get('settings', 'theme');
        if (savedTheme) {
            this.activeTheme = savedTheme.value;
            document.body.className = this.activeTheme;
            document.querySelectorAll('.color-swatch').forEach(sw => {
                sw.classList.toggle('active', sw.getAttribute('data-theme') === this.activeTheme);
            });
        }

        // 3. Connect to Supabase Cloud if credentials available
        this.initSupabaseClient();

        // 4. Set up Event Handlers
        this.setupEventHandlers();
        this.setupTabbedControls();

        // 5. Initial Session Check (Async)
        await this.syncSessionState();
    }

    // Connect to Supabase using priority: 1. LocalStorage overrides, 2. config.js
    initSupabaseClient() {
        let url = localStorage.getItem('supabase_url') || '';
        let key = localStorage.getItem('supabase_anon_key') || '';

        // Fallback to config.js file variables
        if ((!url || !key) && window.AURALIST_CONFIG) {
            url = window.AURALIST_CONFIG.supabaseUrl || '';
            key = window.AURALIST_CONFIG.supabaseAnonKey || '';
        }

        if (url && key && window.supabase) {
            try {
                this.supabase = window.supabase.createClient(url, key);
                console.log('Supabase Cloud client initialized.');
            } catch (err) {
                console.error('Supabase failed to initialize:', err);
                this.supabase = null;
            }
        } else {
            this.supabase = null;
        }
    }

    // Handles initial data loading (from Supabase if logged in, otherwise local fallback)
    async syncSessionState() {
        this.sfx.playClick();

        if (this.supabase) {
            try {
                const { data: { session }, error } = await this.supabase.auth.getSession();
                if (error) throw error;

                if (session && session.user) {
                    this.user = session.user;
                    console.log('Logged in user session detected:', this.user.email);
                    
                    // Show online UI status
                    document.getElementById('syncModeLabel').innerText = 'Cloud Sync';
                    document.getElementById('syncModeLabel').className = 'sync-badge online';
                    document.getElementById('statusUser').innerText = this.user.email;
                    document.getElementById('statusCloud').innerText = 'Connected';
                    
                    // Pull Cloud data
                    await this.pullCloudData();
                    return;
                }
            } catch (err) {
                console.error('Supabase session fetch failed. Running offline fallback:', err);
            }
        }

        // Running offline mode
        this.user = null;
        document.getElementById('syncModeLabel').innerText = 'Offline';
        document.getElementById('syncModeLabel').className = 'sync-badge offline';
        document.getElementById('statusUser').innerText = 'Guest Session';
        document.getElementById('statusCloud').innerText = 'Offline Mode';

        // Load local offline data
        await this.pullLocalOfflineData();

        // Force open login modal on startup if not logged in
        this.openLoginModal(true);
    }

    async pullLocalOfflineData() {
        // Fetch Categories
        this.categories = await this.localDb.getAll('categories');
        if (this.categories.length === 0) {
            const defaults = [
                { id: 'cat-work', name: 'Work', color: '#0066cc' },
                { id: 'cat-personal', name: 'Personal', color: '#7c3aed' },
                { id: 'cat-shopping', name: 'Shopping', color: '#d97706' }
            ];
            for (const cat of defaults) {
                await this.localDb.save('categories', cat);
            }
            this.categories = defaults;
        }

        // Fetch Tasks
        this.tasks = await this.localDb.getAll('tasks');
        this.tasks.sort((a, b) => (a.order || 0) - (b.order || 0));

        this.renderCategories();
        this.renderTaskList();
        this.updateStats();
    }

    async pullCloudData() {
        document.getElementById('statusProgress').innerText = 'Downloading cloud task index...';

        try {
            // 1. Fetch categories
            let { data: dbCategories, error: catError } = await this.supabase
                .from('categories')
                .select('*');
            if (catError) throw catError;

            // If cloud categories are empty, create defaults
            if (!dbCategories || dbCategories.length === 0) {
                const defaults = [
                    { id: 'cat-work', name: 'Work', color: '#0066cc', user_id: this.user.id },
                    { id: 'cat-personal', name: 'Personal', color: '#7c3aed', user_id: this.user.id },
                    { id: 'cat-shopping', name: 'Shopping', color: '#d97706', user_id: this.user.id }
                ];
                await this.supabase.from('categories').insert(defaults);
                dbCategories = defaults;
            }
            this.categories = dbCategories;

            // 2. Fetch Tasks
            let { data: dbTasks, error: tasksError } = await this.supabase
                .from('tasks')
                .select('*')
                .order('order', { ascending: true });
            if (tasksError) throw tasksError;

            this.tasks = dbTasks || [];

            this.renderCategories();
            this.renderTaskList();
            this.updateStats();
            document.getElementById('statusProgress').innerText = 'Cloud synchronization complete.';
        } catch (err) {
            console.error('Cloud pull failed. Reverting to local cache:', err);
            document.getElementById('statusProgress').innerText = 'Network error. Offline cache active.';
            await this.pullLocalOfflineData();
        }
    }

    // Write wrapper (Saves to IndexedDB or Supabase depending on mode)
    async writeTask(task) {
        if (this.user && this.supabase) {
            task.user_id = this.user.id;
            const { error } = await this.supabase.from('tasks').upsert(task);
            if (error) {
                console.error('Supabase task write error:', error);
                // Cache locally as fallback
                await this.localDb.save('tasks', task);
            }
        } else {
            await this.localDb.save('tasks', task);
        }
    }

    async writeCategory(cat) {
        if (this.user && this.supabase) {
            cat.user_id = this.user.id;
            const { error } = await this.supabase.from('categories').upsert(cat);
            if (error) console.error('Supabase category write error:', error);
        } else {
            await this.localDb.save('categories', cat);
        }
    }

    async removeTask(id) {
        if (this.user && this.supabase) {
            const { error } = await this.supabase.from('tasks').delete().eq('id', id);
            if (error) console.error('Supabase task delete error:', error);
        } else {
            await this.localDb.delete('tasks', id);
        }
    }

    async removeCategory(id) {
        if (this.user && this.supabase) {
            const { error } = await this.supabase.from('categories').delete().eq('id', id);
            if (error) console.error('Supabase category delete error:', error);
        } else {
            await this.localDb.delete('categories', id);
        }
    }

    // --- Dynamic User Event Handlers ---
    setupEventHandlers() {
        // App controls triggers
        const exitBtn = document.getElementById('btnExitApp');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                alert('Checklist Utility: To exit this system, simply close this browser page.');
            });
        }

        // Modal triggers
        document.getElementById('btnToolbarNew').addEventListener('click', () => this.openTaskModal());
        document.getElementById('btnMenuNewTask').addEventListener('click', () => this.openTaskModal());
        document.getElementById('btnEmptyCreate').addEventListener('click', () => this.openTaskModal());
        document.getElementById('btnCancelTaskModal').addEventListener('click', () => this.closeTaskModal());
        document.getElementById('btnCancelTask').addEventListener('click', () => this.closeTaskModal());
        document.getElementById('taskForm').addEventListener('submit', () => this.saveTask());

        // Category triggers
        document.getElementById('btnSidebarAddCat').addEventListener('click', () => this.openCategoryModal());
        document.getElementById('btnCancelCategoryModal').addEventListener('click', () => this.closeCategoryModal());
        document.getElementById('btnCancelCategory').addEventListener('click', () => this.closeCategoryModal());
        document.getElementById('categoryForm').addEventListener('submit', () => this.saveCategory());

        // Subtask inputs
        document.getElementById('btnAddSubtask').addEventListener('click', () => this.addSubtaskFromInput());
        document.getElementById('newSubtaskText').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addSubtaskFromInput();
            }
        });

        // Search & Filters toolbar
        document.getElementById('searchTasks').addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.renderTaskList();
        });
        document.getElementById('filterPriority').addEventListener('change', (e) => {
            this.filterPriority = e.target.value;
            this.renderTaskList();
        });
        document.getElementById('filterStatus').addEventListener('change', (e) => {
            this.filterStatus = e.target.value;
            this.renderTaskList();
        });
        document.getElementById('sortBy').addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.renderTaskList();
        });

        // Accent theme selection swatches
        document.querySelectorAll('.color-swatch').forEach(sw => {
            sw.addEventListener('click', async (e) => {
                this.sfx.playClick();
                const theme = e.target.getAttribute('data-theme');
                this.activeTheme = theme;
                document.body.className = theme;
                
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                e.target.classList.add('active');

                await this.localDb.save('settings', { key: 'theme', value: theme });
            });
        });

        // Modal Media files browse handles
        const dropzone = document.getElementById('screenshotDropzone');
        dropzone.addEventListener('click', () => document.getElementById('screenshotInput').click());
        document.getElementById('screenshotInput').addEventListener('change', (e) => this.handleImageUploads(e.target.files));

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.background = '#e2e8f0';
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.background = '#f8fafc';
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.background = '#f8fafc';
            this.handleImageUploads(e.dataTransfer.files);
        });

        // Window copy paste listener
        window.addEventListener('paste', (e) => {
            const modal = document.getElementById('taskModal');
            if (modal.classList.contains('active')) {
                const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                for (const item of items) {
                    if (item.type.indexOf('image') === 0) {
                        const file = item.getAsFile();
                        this.handleImageUploads([file]);
                    }
                }
            }
        });

        // Audio controls hooks
        document.getElementById('btnRecordVoice').addEventListener('click', () => this.toggleVoiceRecording());
        document.getElementById('btnPlayVoice').addEventListener('click', () => this.toggleModalVoicePlayback());
        document.getElementById('btnDeleteVoice').addEventListener('click', () => this.removeVoiceNote());
        document.getElementById('btnUploadAudio').addEventListener('click', () => document.getElementById('audioFileInput').click());
        document.getElementById('audioFileInput').addEventListener('change', (e) => this.handleAudioUpload(e.target.files[0]));

        // Menu Authentication options
        document.getElementById('btnMenuLogin').addEventListener('click', () => this.openLoginModal());
        document.getElementById('btnMenuLogout').addEventListener('click', () => this.handleLogout());
        document.getElementById('btnRunOffline').addEventListener('click', () => this.closeLoginModal());
        document.getElementById('btnCloseLogin').addEventListener('click', () => this.closeLoginModal());
        document.getElementById('btnSubmitLogin').addEventListener('click', () => this.handleLogin(false));
        document.getElementById('btnSubmitRegister').addEventListener('click', () => this.handleLogin(true));

        // Menu settings options
        document.getElementById('btnMenuCloudSettings').addEventListener('click', () => this.openCloudSettingsModal());
        document.getElementById('btnCancelCloudSettings').addEventListener('click', () => this.closeCloudSettingsModal());
        document.getElementById('btnCancelCloudSettingsBtn').addEventListener('click', () => this.closeCloudSettingsModal());
        document.getElementById('btnResetCloudSettings').addEventListener('click', () => this.resetCloudSettingsFields());
        document.getElementById('cloudSettingsForm').addEventListener('submit', () => this.saveCloudSettings());

        // File backups menus
        document.getElementById('btnMenuExport').addEventListener('click', () => this.exportWorkspace());
        document.getElementById('btnMenuImport').addEventListener('click', () => this.importWorkspaceTrigger());
        document.getElementById('btnMenuClear').addEventListener('click', () => this.clearAllData());

        // About modals menus
        document.getElementById('btnMenuAbout').addEventListener('click', () => {
            this.sfx.playClick();
            document.getElementById('aboutModal').classList.add('active');
        });
        document.getElementById('btnCloseAbout').addEventListener('click', () => {
            document.getElementById('aboutModal').classList.remove('active');
        });
        document.getElementById('btnOkAbout').addEventListener('click', () => {
            document.getElementById('aboutModal').classList.remove('active');
        });

        // Category wizard color dot picker
        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', (e) => {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
                e.target.classList.add('selected');
            });
        });

        // Close image lightbox
        document.getElementById('btnCancelLightboxModal').addEventListener('click', () => {
            document.getElementById('lightboxModal').classList.remove('active');
        });

        // Zoom and Pan controls for Lightbox
        document.getElementById('btnZoomIn').addEventListener('click', () => this.zoomIn());
        document.getElementById('btnZoomOut').addEventListener('click', () => this.zoomOut());
        document.getElementById('btnZoomReset').addEventListener('click', () => this.zoomReset());

        const frame = document.querySelector('.image-viewer-frame');
        let isDragging = false;
        let startX, startY, scrollLeft, scrollTop;

        frame.addEventListener('mousedown', (e) => {
            if (this.isFitMode) return;
            isDragging = true;
            frame.classList.add('grabbing');
            startX = e.pageX - frame.offsetLeft;
            startY = e.pageY - frame.offsetTop;
            scrollLeft = frame.scrollLeft;
            scrollTop = frame.scrollTop;
        });

        frame.addEventListener('mouseleave', () => {
            isDragging = false;
            frame.classList.remove('grabbing');
        });

        frame.addEventListener('mouseup', () => {
            isDragging = false;
            frame.classList.remove('grabbing');
        });

        frame.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const x = e.pageX - frame.offsetLeft;
            const y = e.pageY - frame.offsetTop;
            const walkX = (x - startX);
            const walkY = (y - startY);
            frame.scrollLeft = scrollLeft - walkX;
            frame.scrollTop = scrollTop - walkY;
        });

        // Inline Preview Events
        document.getElementById('btnCloseInlinePreview').addEventListener('click', () => this.closeInlinePreview());
        document.getElementById('btnInlineZoomIn').addEventListener('click', () => this.inlineZoomIn());
        document.getElementById('btnInlineZoomOut').addEventListener('click', () => this.inlineZoomOut());
        document.getElementById('btnInlineZoomReset').addEventListener('click', () => this.inlineZoomReset());

        const inlineFrame = document.querySelector('.inline-preview-frame');
        let isInlineDragging = false;
        let inlineStartX, inlineStartY, inlineScrollLeft, inlineScrollTop;

        inlineFrame.addEventListener('mousedown', (e) => {
            if (this.isInlineFitMode) return;
            isInlineDragging = true;
            inlineFrame.classList.add('grabbing');
            inlineStartX = e.pageX - inlineFrame.offsetLeft;
            inlineStartY = e.pageY - inlineFrame.offsetTop;
            inlineScrollLeft = inlineFrame.scrollLeft;
            inlineScrollTop = inlineFrame.scrollTop;
        });

        inlineFrame.addEventListener('mouseleave', () => {
            isInlineDragging = false;
            inlineFrame.classList.remove('grabbing');
        });

        inlineFrame.addEventListener('mouseup', () => {
            isInlineDragging = false;
            inlineFrame.classList.remove('grabbing');
        });

        inlineFrame.addEventListener('mousemove', (e) => {
            if (!isInlineDragging) return;
            e.preventDefault();
            const x = e.pageX - inlineFrame.offsetLeft;
            const y = e.pageY - inlineFrame.offsetTop;
            const walkX = (x - inlineStartX);
            const walkY = (y - inlineStartY);
            inlineFrame.scrollLeft = inlineScrollLeft - walkX;
            inlineFrame.scrollTop = inlineScrollTop - walkY;
        });

        // Drag reorder handles
        const taskListContainer = document.getElementById('taskList');
        taskListContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.sortBy !== 'custom') return;
            const draggingCard = document.querySelector('.task-card.dragging');
            if (!draggingCard) return;
            const afterElement = this.getDragAfterElement(taskListContainer, e.clientY);
            if (afterElement == null) {
                taskListContainer.appendChild(draggingCard);
            } else {
                taskListContainer.insertBefore(draggingCard, afterElement);
            }
        });

        taskListContainer.addEventListener('drop', async () => {
            if (this.sortBy !== 'custom') return;
            const cards = Array.from(taskListContainer.querySelectorAll('.task-card'));
            cards.forEach(async (card, idx) => {
                const id = card.getAttribute('data-id');
                const task = this.tasks.find(t => t.id === id);
                if (task) {
                    task.order = idx;
                    await this.writeTask(task);
                }
            });
            this.tasks.sort((a, b) => (a.order || 0) - (b.order || 0));
            this.updateStats();
        });
    }

    // --- Tab Switching inside Modals ---
    setupTabbedControls() {
        // Tab switching disabled: all sections merged into a single scrollable form
    }

    // Reset task tabs when opening modal
    resetTaskTabs() {
        // Disabled: single page modal layout
    }

    // --- Supabase Cloud Authentication Screen ---
    openLoginModal(forceLogin = false) {
        document.getElementById('loginForm').reset();

        const closeBtn = document.getElementById('btnCloseLogin');
        const offlineBtn = document.getElementById('btnRunOffline');

        if (forceLogin) {
            if (closeBtn) closeBtn.style.display = 'none';
            if (offlineBtn) offlineBtn.style.display = 'none';
        } else {
            if (closeBtn) closeBtn.style.display = '';
            if (offlineBtn) offlineBtn.style.display = '';
        }

        document.getElementById('loginModal').classList.add('active');
    }

    closeLoginModal() {
        // If not logged in, do not allow closing the login screen
        if (!this.user) {
            alert('Please log in with the authorized credentials to continue.');
            return;
        }
        document.getElementById('loginModal').classList.remove('active');
    }

    async handleLogin(isRegistering = false) {
        this.sfx.playClick();
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!email || !password) {
            alert('Please fill out email and password fields.');
            return;
        }

        // Restrict login to ONLY the user's specified shared credentials
        if (email.toLowerCase() !== 'pravekjava@gmail.com' || password !== 'maaef2026') {
            alert('Invalid credentials. Please use the authorized username and password.');
            return;
        }

        if (!this.supabase) {
            alert('Supabase client not connected. Configure connection settings in Network -> Supabase Setup.');
            return;
        }

        document.getElementById('statusProgress').innerText = 'Authenticating user...';

        try {
            // First, try to sign in
            let authResponse = await this.supabase.auth.signInWithPassword({ email, password });
            
            // If sign in fails due to user not found (e.g. first run), automatically register them!
            if (authResponse.error) {
                const errMsg = authResponse.error.message;
                if (errMsg.includes('Invalid login credentials') || authResponse.error.status === 400 || errMsg.includes('Email not confirmed')) {
                    document.getElementById('statusProgress').innerText = 'Registering credentials on Supabase...';
                    const signUpResponse = await this.supabase.auth.signUp({ email, password });
                    if (signUpResponse.error) throw signUpResponse.error;
                    
                    alert('Authorized account registered successfully on your Supabase! Logged in.');
                    // Re-authenticate to get session
                    authResponse = await this.supabase.auth.signInWithPassword({ email, password });
                    if (authResponse.error) throw authResponse.error;
                } else {
                    throw authResponse.error;
                }
            } else {
                alert('Sign in successful!');
            }

            // Temporary reveal buttons to allow closing the modal
            const closeBtn = document.getElementById('btnCloseLogin');
            const offlineBtn = document.getElementById('btnRunOffline');
            if (closeBtn) closeBtn.style.display = '';
            if (offlineBtn) offlineBtn.style.display = '';

            this.closeLoginModal();
            await this.syncSessionState();
        } catch (err) {
            alert(`Authentication Error: ${err.message}`);
            document.getElementById('statusProgress').innerText = 'Auth failed.';
        }
    }

    async handleLogout() {
        this.sfx.playClick();

        if (confirm('Log out? Your task list will revert to offline cache.')) {
            if (this.supabase) {
                await this.supabase.auth.signOut();
            }
            window.location.reload();
        }
    }

    // --- Network / Supabase Settings Panel ---
    openCloudSettingsModal() {
        this.sfx.playClick();
        document.getElementById('setupDbUrl').value = localStorage.getItem('supabase_url') || '';
        document.getElementById('setupDbKey').value = localStorage.getItem('supabase_anon_key') || '';
        document.getElementById('cloudSettingsModal').classList.add('active');
    }

    closeCloudSettingsModal() {
        document.getElementById('cloudSettingsModal').classList.remove('active');
    }

    resetCloudSettingsFields() {
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_anon_key');
        document.getElementById('setupDbUrl').value = '';
        document.getElementById('setupDbKey').value = '';
        alert('Credentials reset. App will load default settings from config.js or fallback to offline.');
    }

    async saveCloudSettings() {
        const url = document.getElementById('setupDbUrl').value.trim();
        const key = document.getElementById('setupDbKey').value.trim();

        if (url) localStorage.setItem('supabase_url', url);
        else localStorage.removeItem('supabase_url');

        if (key) localStorage.setItem('supabase_anon_key', key);
        else localStorage.removeItem('supabase_anon_key');

        alert('Cloud sync settings saved! The application will now reload to establish database link.');
        window.location.reload();
    }

    // --- Statistics Manager ---
    updateStats() {
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.completed).length;
        const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

        document.getElementById('statCompleted').innerText = `${completed} / ${total}`;
        document.getElementById('statProgressFill').style.width = `${percentage}%`;

        // Update counts in sidebar list
        this.categories.forEach(cat => {
            const countEl = document.getElementById(`count-${cat.id}`);
            if (countEl) {
                const count = this.tasks.filter(t => t.category === cat.id).length;
                countEl.innerText = count;
            }
        });
        
        const countAll = document.getElementById('count-all');
        if (countAll) countAll.innerText = total;

        document.getElementById('statusProgress').innerText = `${completed} of ${total} points completed (${percentage}%)`;
    }

    // --- Categories Renderer ---
    renderCategories() {
        const container = document.getElementById('categoryListBox');
        container.innerHTML = '';

        // All category item
        const allItem = document.createElement('div');
        allItem.className = `list-box-item ${this.activeCategory === 'all' ? 'active' : ''}`;
        allItem.innerHTML = `
            <div class="list-item-left">
                <span class="cat-bullet" style="background-color: var(--title-bg-mid);"></span>
                <span>All Tasks</span>
            </div>
            <span class="cat-count-badge" id="count-all">${this.tasks.length}</span>
        `;
        allItem.addEventListener('click', () => {
            this.activeCategory = 'all';
            this.renderCategories();
            this.renderTaskList();
        });
        container.appendChild(allItem);

        // User categories list
        this.categories.forEach(cat => {
            const isActive = this.activeCategory === cat.id;
            const item = document.createElement('div');
            item.className = `list-box-item ${isActive ? 'active' : ''}`;
            item.innerHTML = `
                <div class="list-item-left">
                    <span class="cat-bullet" style="background-color: ${cat.color};"></span>
                    <span>${cat.name}</span>
                </div>
                <div style="display:flex; align-items:center; gap: 4px;">
                    <span class="cat-count-badge" id="count-${cat.id}">0</span>
                    ${['cat-work', 'cat-personal', 'cat-shopping'].includes(cat.id) ? '' : `
                        <button class="btn-action-icon btn-danger-action btn-del-cat" style="width:14px; height:14px; font-size:8px;">&times;</button>
                    `}
                </div>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-del-cat')) {
                    e.stopPropagation();
                    this.deleteCategory(cat.id);
                    return;
                }
                this.activeCategory = cat.id;
                this.renderCategories();
                this.renderTaskList();
            });

            container.appendChild(item);
        });

        // Set category dropdown options in editor modal
        const select = document.getElementById('taskCategory');
        select.innerHTML = '';
        this.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.innerText = cat.name;
            select.appendChild(opt);
        });
    }

    openCategoryModal() {
        this.sfx.playClick();
        document.getElementById('newCategoryName').value = '';
        document.getElementById('categoryModal').classList.add('active');
    }

    closeCategoryModal() {
        document.getElementById('categoryModal').classList.remove('active');
    }

    async saveCategory() {
        const name = document.getElementById('newCategoryName').value.trim();
        if (!name) return;

        const colorDot = document.querySelector('.color-dot.selected');
        const color = colorDot ? colorDot.getAttribute('data-color') : '#0066cc';
        const id = 'cat-' + Date.now();

        const newCat = { id, name, color };
        this.categories.push(newCat);
        await this.writeCategory(newCat);
        
        this.renderCategories();
        this.updateStats();
        this.closeCategoryModal();
    }

    async deleteCategory(id) {
        if (confirm('Delete category? Tasks inside will revert to Work.')) {
            this.categories = this.categories.filter(c => c.id !== id);
            await this.removeCategory(id);

            this.tasks.forEach(async (task) => {
                if (task.category === id) {
                    task.category = 'cat-work';
                    await this.writeTask(task);
                }
            });

            if (this.activeCategory === id) this.activeCategory = 'all';
            this.renderCategories();
            this.renderTaskList();
            this.updateStats();
        }
    }

    // --- Task Modal Configuration (Editor) ---
    openTaskModal(task = null) {
        this.sfx.playClick();
        const form = document.getElementById('taskForm');
        form.reset();
        
        this.modalScreenshots = [];
        this.modalVoiceNote = null;
        document.getElementById('modalSubtaskList').innerHTML = '';
        this.closeInlinePreview();

        if (task) {
            document.getElementById('taskModalHeader').innerText = 'Task Configuration - properties';
            document.getElementById('taskId').value = task.id;
            document.getElementById('taskTitle').value = task.title;
            document.getElementById('taskDesc').value = task.description || '';
            document.getElementById('taskCategory').value = task.category || 'cat-work';
            document.getElementById('taskPriority').value = task.priority || 'medium';
            document.getElementById('taskDueDate').value = task.dueDate || '';

            this.modalScreenshots = [...(task.screenshots || [])];
            this.modalVoiceNote = task.voiceNote || null;

            // Load subtasks
            const container = document.getElementById('modalSubtaskList');
            (task.subtasks || []).forEach(sub => {
                container.appendChild(this.createSubtaskDOMElement(sub.title, sub.completed));
            });
        } else {
            document.getElementById('taskModalHeader').innerText = 'Task Configuration - New Record';
            document.getElementById('taskId').value = '';
            if (this.activeCategory !== 'all') {
                document.getElementById('taskCategory').value = this.activeCategory;
            }
        }

        this.renderModalScreenshots();
        this.renderModalVoiceNoteState();
        document.getElementById('taskModal').classList.add('active');
        lucide.createIcons();
    }

    closeTaskModal() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        this.stopModalVoicePlayback();
        this.closeInlinePreview();
        document.getElementById('taskModal').classList.remove('active');
    }

    // --- Subtasks Lists managers ---
    createSubtaskDOMElement(text, completed) {
        const item = document.createElement('div');
        item.className = 'subtask-list-item';
        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px;">
                <div class="checkbox-container ${completed ? 'checked' : ''}" style="width:14px; height:14px;">
                    <i data-lucide="check" class="checkmark-icon" style="width:10px; height:10px;"></i>
                </div>
                <span class="${completed ? 'text-crossed' : ''}" style="font-size:11px;">${text}</span>
            </div>
            <button type="button" class="btn-action-icon btn-danger-action btn-del-sub">&times;</button>
        `;

        item.querySelector('.checkbox-container').addEventListener('click', (e) => {
            const container = e.currentTarget;
            const checked = container.classList.toggle('checked');
            item.querySelector('span').classList.toggle('text-crossed', checked);
            this.sfx.playClick();
        });

        item.querySelector('.btn-del-sub').addEventListener('click', () => {
            item.remove();
        });

        return item;
    }

    addSubtaskFromInput() {
        const input = document.getElementById('newSubtaskText');
        const text = input.value.trim();
        if (!text) return;

        const container = document.getElementById('modalSubtaskList');
        container.appendChild(this.createSubtaskDOMElement(text, false));
        input.value = '';
        lucide.createIcons();
        container.scrollTop = container.scrollHeight;
    }

    // --- Screenshot upload handlers ---
    handleImageUploads(files) {
        this.sfx.playClick();
        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    this.modalScreenshots.push(e.target.result);
                    this.renderModalScreenshots();
                };
                reader.readAsDataURL(file);
            }
        });
    }

    renderModalScreenshots() {
        const container = document.getElementById('screenshotContainer');
        container.innerHTML = '';

        this.modalScreenshots.forEach((src, idx) => {
            const wrap = document.createElement('div');
            wrap.className = 'thumbnail-wrapper';
            wrap.innerHTML = `
                <img src="${src}" alt="Screenshot" class="thumbnail-img">
                <button type="button" class="btn-delete-thumbnail" data-idx="${idx}">&times;</button>
            `;

            wrap.querySelector('img').addEventListener('click', () => {
                this.openInlinePreview(src);
            });

            wrap.querySelector('.btn-delete-thumbnail').addEventListener('click', (e) => {
                e.stopPropagation();
                this.modalScreenshots.splice(idx, 1);
                this.renderModalScreenshots();
            });

            container.appendChild(wrap);
        });
    }

    openLightbox(src) {
        this.sfx.playClick();
        const modal = document.getElementById('lightboxModal');
        const img = document.getElementById('lightboxImage');
        const dl = document.getElementById('btnDownloadImage');
        const frame = document.querySelector('.image-viewer-frame');

        this.isFitMode = true;
        this.zoomScale = 1.0;

        // Remove zoomed classes and scroll positioning
        if (frame) {
            frame.classList.remove('zoomed', 'grabbing');
            frame.scrollLeft = 0;
            frame.scrollTop = 0;
        }

        img.onload = () => {
            this.updateZoom();
        };

        img.src = src;
        dl.href = src;
        modal.classList.add('active');
        this.updateZoom();
    }

    updateZoom() {
        const img = document.getElementById('lightboxImage');
        const frame = document.querySelector('.image-viewer-frame');
        const zoomPercentSpan = document.getElementById('zoomPercent');
        if (!img || !frame || !zoomPercentSpan) return;

        if (this.isFitMode) {
            frame.classList.remove('zoomed');
            img.style.width = 'auto';
            img.style.height = 'auto';
            img.style.transform = 'none';

            // Calculate the fit percentage
            if (img.naturalWidth && img.clientWidth) {
                const fitPercent = Math.round((img.clientWidth / img.naturalWidth) * 100);
                zoomPercentSpan.innerText = `Fit (${fitPercent}%)`;
            } else {
                zoomPercentSpan.innerText = 'Fit';
            }
        } else {
            frame.classList.add('zoomed');
            img.style.width = `${img.naturalWidth * this.zoomScale}px`;
            img.style.height = 'auto';
            img.style.transform = 'none';
            zoomPercentSpan.innerText = `${Math.round(this.zoomScale * 100)}%`;
        }
    }

    zoomIn() {
        this.sfx.playClick();
        const img = document.getElementById('lightboxImage');
        if (!img || !img.naturalWidth) return;

        if (this.isFitMode) {
            // Find current fitted ratio to start from
            const currentFitScale = img.clientWidth / img.naturalWidth;
            this.zoomScale = currentFitScale;
            this.isFitMode = false;
        }

        const steps = [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
        let nextStep = steps.find(s => s > this.zoomScale + 0.01);
        if (!nextStep) nextStep = 4.0;

        this.zoomScale = nextStep;
        this.updateZoom();
    }

    zoomOut() {
        this.sfx.playClick();
        const img = document.getElementById('lightboxImage');
        if (!img || !img.naturalWidth) return;

        if (this.isFitMode) {
            const currentFitScale = img.clientWidth / img.naturalWidth;
            this.zoomScale = currentFitScale;
            this.isFitMode = false;
        }

        const steps = [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
        let prevStep = [...steps].reverse().find(s => s < this.zoomScale - 0.01);
        if (!prevStep) prevStep = 0.1;

        this.zoomScale = prevStep;
        this.updateZoom();
    }

    zoomReset() {
        this.sfx.playClick();
        const frame = document.querySelector('.image-viewer-frame');
        this.isFitMode = true;
        this.zoomScale = 1.0;
        if (frame) {
            frame.scrollLeft = 0;
            frame.scrollTop = 0;
        }
        this.updateZoom();
    }

    openInlinePreview(src) {
        const container = document.getElementById('inlinePreviewContainer');
        const img = document.getElementById('inlinePreviewImage');
        const frame = document.querySelector('.inline-preview-frame');

        if (!container || !img) return;

        this.isInlineFitMode = true;
        this.inlineZoomScale = 1.0;

        if (frame) {
            frame.classList.remove('zoomed', 'grabbing');
            frame.scrollLeft = 0;
            frame.scrollTop = 0;
        }

        img.onload = () => {
            this.updateInlineZoom();
        };

        img.src = src;
        container.classList.remove('hidden');
        this.updateInlineZoom();

        // Scroll the container slightly to make sure the preview is visible
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    closeInlinePreview() {
        const container = document.getElementById('inlinePreviewContainer');
        if (container) {
            container.classList.add('hidden');
        }
    }

    updateInlineZoom() {
        const img = document.getElementById('inlinePreviewImage');
        const frame = document.querySelector('.inline-preview-frame');
        const zoomPercentSpan = document.getElementById('inlineZoomPercent');
        if (!img || !frame || !zoomPercentSpan) return;

        if (this.isInlineFitMode) {
            frame.classList.remove('zoomed');
            img.style.width = 'auto';
            img.style.height = 'auto';
            img.style.transform = 'none';

            // Calculate the fit percentage
            if (img.naturalWidth && img.clientWidth) {
                const fitPercent = Math.round((img.clientWidth / img.naturalWidth) * 100);
                zoomPercentSpan.innerText = `Fit (${fitPercent}%)`;
            } else {
                zoomPercentSpan.innerText = 'Fit';
            }
        } else {
            frame.classList.add('zoomed');
            img.style.width = `${img.naturalWidth * this.inlineZoomScale}px`;
            img.style.height = 'auto';
            img.style.transform = 'none';
            zoomPercentSpan.innerText = `${Math.round(this.inlineZoomScale * 100)}%`;
        }
    }

    inlineZoomIn() {
        this.sfx.playClick();
        const img = document.getElementById('inlinePreviewImage');
        if (!img || !img.naturalWidth) return;

        if (this.isInlineFitMode) {
            const currentFitScale = img.clientWidth / img.naturalWidth;
            this.inlineZoomScale = currentFitScale;
            this.isInlineFitMode = false;
        }

        const steps = [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
        let nextStep = steps.find(s => s > this.inlineZoomScale + 0.01);
        if (!nextStep) nextStep = 4.0;

        this.inlineZoomScale = nextStep;
        this.updateInlineZoom();
    }

    inlineZoomOut() {
        this.sfx.playClick();
        const img = document.getElementById('inlinePreviewImage');
        if (!img || !img.naturalWidth) return;

        if (this.isInlineFitMode) {
            const currentFitScale = img.clientWidth / img.naturalWidth;
            this.inlineZoomScale = currentFitScale;
            this.isInlineFitMode = false;
        }

        const steps = [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
        let prevStep = [...steps].reverse().find(s => s < this.inlineZoomScale - 0.01);
        if (!prevStep) prevStep = 0.1;

        this.inlineZoomScale = prevStep;
        this.updateInlineZoom();
    }

    inlineZoomReset() {
        this.sfx.playClick();
        const frame = document.querySelector('.inline-preview-frame');
        this.isInlineFitMode = true;
        this.inlineZoomScale = 1.0;
        if (frame) {
            frame.scrollLeft = 0;
            frame.scrollTop = 0;
        }
        this.updateInlineZoom();
    }

    // --- Voice Recording modules ---
    renderModalVoiceNoteState() {
        const winamp = document.getElementById('winampPlayer');
        this.stopModalVoicePlayback();

        if (this.modalVoiceNote) {
            winamp.classList.remove('hidden');
            document.getElementById('winampTimer').innerText = '00:00';
        } else {
            winamp.classList.add('hidden');
            document.getElementById('voiceRecordStatusLabel').innerText = 'Voice Recorder Ready';
            document.getElementById('recordingTimer').innerText = '00:00';
            document.getElementById('btnRecordVoice').className = 'mic-trigger-btn';
        }
    }

    async toggleVoiceRecording() {
        const btn = document.getElementById('btnRecordVoice');
        const label = document.getElementById('voiceRecordStatusLabel');
        const timer = document.getElementById('recordingTimer');

        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            btn.classList.remove('recording');
            label.innerText = 'Voice Note Captured';
            clearInterval(this.recordingTimerInterval);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioChunks = [];
            this.mediaRecorder = new MediaRecorder(stream);

            this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onloadend = () => {
                    this.modalVoiceNote = reader.result;
                    this.renderModalVoiceNoteState();
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach(t => t.stop());
            };

            this.mediaRecorder.start();
            btn.classList.add('recording');
            label.innerText = 'Recording voice...';
            this.recordingSeconds = 0;
            timer.innerText = '00:00';

            this.recordingTimerInterval = setInterval(() => {
                this.recordingSeconds++;
                const min = String(Math.floor(this.recordingSeconds / 60)).padStart(2, '0');
                const sec = String(this.recordingSeconds % 60).padStart(2, '0');
                timer.innerText = `${min}:${sec}`;
            }, 1000);

        } catch (err) {
            alert('Cannot access microphone inputs.');
        }
    }

    handleAudioUpload(file) {
        if (!file || !file.type.startsWith('audio/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            this.modalVoiceNote = e.target.result;
            this.renderModalVoiceNoteState();
        };
        reader.readAsDataURL(file);
    }

    removeVoiceNote() {
        if (confirm('Delete recorded voice note?')) {
            this.modalVoiceNote = null;
            this.renderModalVoiceNoteState();
        }
    }

    toggleModalVoicePlayback() {
        const player = document.getElementById('winampPlayer');
        const timer = document.getElementById('winampTimer');
        const fill = document.getElementById('winampSeekerFill');
        const playBtn = document.getElementById('btnPlayVoice');

        if (this.activeAudioElement && !this.activeAudioElement.paused) {
            this.stopModalVoicePlayback();
            return;
        }

        this.activeAudioElement = new Audio(this.modalVoiceNote);
        this.activeAudioElement.play();
        player.classList.add('playing');
        playBtn.innerHTML = '<i data-lucide="pause" class="icon-small"></i>';
        lucide.createIcons();

        // Animate simulated Winamp visualizer
        this.visualizerInterval = setInterval(() => {
            document.querySelectorAll('.winamp-spectrum .spec-bar').forEach(bar => {
                const height = Math.floor(Math.random() * 90) + 10;
                bar.style.height = `${height}%`;
            });
        }, 80);

        this.audioPlayInterval = setInterval(() => {
            if (!this.activeAudioElement) return;
            const progress = (this.activeAudioElement.currentTime / this.activeAudioElement.duration) * 100;
            fill.style.width = `${progress}%`;
            
            const min = String(Math.floor(this.activeAudioElement.currentTime / 60)).padStart(2, '0');
            const sec = String(Math.floor(this.activeAudioElement.currentTime % 60)).padStart(2, '0');
            timer.innerText = `${min}:${sec}`;
        }, 100);

        this.activeAudioElement.onended = () => {
            this.stopModalVoicePlayback();
        };
    }

    stopModalVoicePlayback() {
        if (this.activeAudioElement) {
            this.activeAudioElement.pause();
            this.activeAudioElement = null;
        }
        clearInterval(this.audioPlayInterval);
        clearInterval(this.visualizerInterval);

        const player = document.getElementById('winampPlayer');
        const timer = document.getElementById('winampTimer');
        const fill = document.getElementById('winampSeekerFill');
        const playBtn = document.getElementById('btnPlayVoice');

        if (player) player.classList.remove('playing');
        if (timer) timer.innerText = '00:00';
        if (fill) fill.style.width = '0%';
        if (playBtn) playBtn.innerHTML = '<i data-lucide="play" class="icon-small"></i>';
        
        // Reset spectrum bars
        document.querySelectorAll('.winamp-spectrum .spec-bar').forEach(bar => {
            bar.style.height = '10%';
        });
        lucide.createIcons();
    }

    // --- Save Task Logic (Local Cache vs Supabase Storage Buckets) ---
    async saveTask() {
        this.sfx.playClick();
        const idInput = document.getElementById('taskId').value;
        const title = document.getElementById('taskTitle').value.trim();
        const description = document.getElementById('taskDesc').value.trim();
        const category = document.getElementById('taskCategory').value;
        const priority = document.getElementById('taskPriority').value;
        const dueDate = document.getElementById('taskDueDate').value;

        if (!title) return;

        document.getElementById('statusProgress').innerText = 'Saving checklist configurations...';

        // Map subtasks
        const subtaskDOMs = Array.from(document.querySelectorAll('.subtask-list-item'));
        const subtasks = subtaskDOMs.map(el => ({
            title: el.querySelector('span').innerText,
            completed: el.querySelector('.checkbox-container').classList.contains('checked')
        }));

        const taskId = idInput || 'task-' + Date.now();
        
        // Setup media storage routes (Online Bucket uploads)
        let cloudScreenshots = [];
        let cloudVoiceNote = null;

        if (this.user && this.supabase) {
            // 1. Upload Screenshots to Supabase Storage Bucket
            for (let i = 0; i < this.modalScreenshots.length; i++) {
                const src = this.modalScreenshots[i];
                if (src.startsWith('data:')) {
                    // Upload Base64 DataURL
                    const uploadedUrl = await this.uploadMediaToCloud(taskId, `img_${i}_${Date.now()}.png`, src);
                    if (uploadedUrl) cloudScreenshots.push(uploadedUrl);
                } else {
                    // Already a cloud URL
                    cloudScreenshots.push(src);
                }
            }

            // 2. Upload Voice note
            if (this.modalVoiceNote) {
                if (this.modalVoiceNote.startsWith('data:')) {
                    const uploadedUrl = await this.uploadMediaToCloud(taskId, `voice_${Date.now()}.webm`, this.modalVoiceNote);
                    if (uploadedUrl) cloudVoiceNote = uploadedUrl;
                } else {
                    cloudVoiceNote = this.modalVoiceNote;
                }
            }
        } else {
            // Offline IndexedDB handles Base64 directly
            cloudScreenshots = this.modalScreenshots;
            cloudVoiceNote = this.modalVoiceNote;
        }

        let task = this.tasks.find(t => t.id === taskId);
        if (task) {
            task.title = title;
            task.description = description;
            task.category = category;
            task.priority = priority;
            task.dueDate = dueDate;
            task.subtasks = subtasks;
            task.screenshots = cloudScreenshots;
            task.voiceNote = cloudVoiceNote;
        } else {
            task = {
                id: taskId,
                title,
                description,
                category,
                priority,
                dueDate,
                completed: false,
                subtasks,
                screenshots: cloudScreenshots,
                voiceNote: cloudVoiceNote,
                order: this.tasks.length
            };
            this.tasks.push(task);
        }

        await this.writeTask(task);
        this.renderTaskList();
        this.updateStats();
        this.closeTaskModal();
    }

    // Helper: Upload file base64 data to Supabase Storage
    async uploadMediaToCloud(taskId, fileName, dataUrl) {
        try {
            // Convert Base64 dataURL to Blob
            const response = await fetch(dataUrl);
            const blob = await response.blob();

            const filePath = `${this.user.id}/${taskId}/${fileName}`;
            
            // Upload to Supabase bucket 'auralist-media'
            const { data, error } = await this.supabase.storage
                .from('auralist-media')
                .upload(filePath, blob, { contentType: blob.type, upsert: true });

            if (error) throw error;

            // Retrieve Public URL
            const { data: urlData } = this.supabase.storage
                .from('auralist-media')
                .getPublicUrl(filePath);

            return urlData.publicUrl;
        } catch (err) {
            console.error('Failed to upload file to cloud storage bucket:', err);
            return null;
        }
    }

    // --- Task Cards checklists renderers ---
    async toggleTaskCompleted(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.completed = !task.completed;
            if (task.completed) {
                // Play retro complete chime!
                this.sfx.playChime();
            } else {
                this.sfx.playClick();
            }
            await this.writeTask(task);
            this.renderTaskList();
            this.updateStats();
        }
    }

    async deleteTask(id) {
        this.sfx.playClick();
        if (confirm('Permanently delete checklist point item?')) {
            this.tasks = this.tasks.filter(t => t.id !== id);
            await this.removeTask(id);
            this.renderTaskList();
            this.updateStats();
        }
    }

    renderTaskList() {
        const container = document.getElementById('taskList');
        const emptyState = document.getElementById('emptyState');
        container.innerHTML = '';

        this.stopCardAudioPlayback();

        // 1. Filtering Logic
        let filtered = this.tasks.filter(task => {
            if (this.searchQuery) {
                const q = this.searchQuery.toLowerCase();
                const mTitle = task.title.toLowerCase().includes(q);
                const mDesc = (task.description || '').toLowerCase().includes(q);
                if (!mTitle && !mDesc) return false;
            }

            if (this.filterStatus !== 'all') {
                if (this.filterStatus === 'completed' && !task.completed) return false;
                if (this.filterStatus === 'active' && task.completed) return false;
            }

            return true;
        });

        // 2. Sorting Logic
        if (this.sortBy === 'title') {
            filtered.sort((a, b) => a.title.localeCompare(b.title));
        } else {
            filtered.sort((a, b) => (a.order || 0) - (b.order || 0));
        }

        // Toggle Empty state view
        if (filtered.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }
        emptyState.classList.add('hidden');

        // Create cards HTML
        filtered.forEach(task => {
            const card = document.createElement('div');
            card.className = `task-card ${task.completed ? 'completed' : ''}`;
            card.setAttribute('data-id', task.id);
            card.setAttribute('draggable', this.sortBy === 'custom' ? 'true' : 'false');

            if (this.sortBy === 'custom') {
                card.addEventListener('dragstart', () => card.classList.add('dragging'));
                card.addEventListener('dragend', () => card.classList.remove('dragging'));
            }

            // Subtask counts
            let subHTML = '';
            if (task.subtasks && task.subtasks.length > 0) {
                const comp = task.subtasks.filter(s => s.completed).length;
                const tot = task.subtasks.length;
                const perc = Math.round((comp / tot) * 100);
                subHTML = `
                    <div class="task-card-subtasks-progress">
                        <div class="subtasks-bar-header">
                            <span>Checklist points</span>
                            <span>${comp}/${tot} (${perc}%)</span>
                        </div>
                        <div class="stat-progress-bar-container">
                            <div class="stat-progress-bar-fill" style="width: ${perc}%; background: linear-gradient(to right, #3b82f6 0%, #60a5fa 100%);"></div>
                        </div>
                    </div>
                `;
            }

            // Image attachments
            let imgHTML = '';
            if (task.screenshots && task.screenshots.length > 0) {
                const previews = task.screenshots.slice(0, 3).map(src => `
                    <div class="card-screenshot-thumbnail" style="background-image: url('${src}');" data-src="${src}"></div>
                `).join('');
                
                const extra = task.screenshots.length > 3 ? `
                    <div class="card-screenshot-more">+${task.screenshots.length - 3}</div>
                ` : '';

                imgHTML = `
                    <div class="card-media-previews">
                        ${previews}
                        ${extra}
                    </div>
                `;
            }

            // Audio Player
            let audioHTML = '';
            if (task.voiceNote) {
                audioHTML = `
                    <div class="card-audio-player" data-src="${task.voiceNote}">
                        <button type="button" class="card-audio-btn">
                            <i data-lucide="play"></i>
                        </button>
                        <div class="card-audio-waveform">
                            <div class="card-audio-progress"></div>
                        </div>
                        <span class="card-audio-time">0:00</span>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="checkbox-container ${task.completed ? 'checked' : ''}">
                    <i data-lucide="check" class="checkmark-icon"></i>
                </div>

                <div>
                    <div class="task-card-title">${task.title}</div>
                    ${task.description ? `<p class="task-card-desc" style="margin-top: 4px;">${task.description}</p>` : ''}
                    ${subHTML}
                    ${imgHTML}
                    ${audioHTML}
                </div>

                <div class="task-actions">
                    ${this.sortBy === 'custom' ? '<div class="reorder-handle"><i data-lucide="grip-vertical" class="icon-small"></i></div>' : ''}
                    <button class="btn-action-icon btn-edit-task" title="Edit Properties"><i data-lucide="edit-2" class="icon-small"></i></button>
                    <button class="btn-action-icon btn-danger-action btn-delete-task" title="Delete Task"><i data-lucide="trash-2" class="icon-small"></i></button>
                </div>
            `;

            // Card click hooks
            card.querySelector('.checkbox-container').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTaskCompleted(task.id);
            });

            card.querySelector('.btn-edit-task').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openTaskModal(task);
            });

            card.querySelector('.btn-delete-task').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteTask(task.id);
            });

            card.querySelectorAll('.card-screenshot-thumbnail').forEach(t => {
                t.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openLightbox(e.target.getAttribute('data-src'));
                });
            });

            const more = card.querySelector('.card-screenshot-more');
            if (more) {
                more.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openTaskModal(task);
                });
            }

            // Audio trigger binding
            const audioPlayer = card.querySelector('.card-audio-player');
            if (audioPlayer) {
                const btn = audioPlayer.querySelector('.card-audio-btn');
                const fill = audioPlayer.querySelector('.card-audio-progress');
                const time = audioPlayer.querySelector('.card-audio-time');
                const src = audioPlayer.getAttribute('data-src');

                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleCardAudioPlayback(btn, fill, time, src);
                });
            }

            container.appendChild(card);
        });

        lucide.createIcons();
    }

    // --- Audio players in cards ---
    toggleCardAudioPlayback(btn, fill, timeText, src) {
        if (this.activeAudioElement && this.activeAudioBtn === btn) {
            this.stopCardAudioPlayback();
            return;
        }

        this.stopCardAudioPlayback();

        this.activeAudioElement = new Audio(src);
        this.activeAudioBtn = btn;
        this.activeAudioProgressBar = fill;
        this.activeAudioTime = timeText;

        this.activeAudioElement.play();
        btn.innerHTML = '<i data-lucide="pause"></i>';
        lucide.createIcons();

        this.audioPlayInterval = setInterval(() => {
            if (!this.activeAudioElement) return;
            const progress = (this.activeAudioElement.currentTime / this.activeAudioElement.duration) * 100;
            fill.style.width = `${progress}%`;
            
            const min = String(Math.floor(this.activeAudioElement.currentTime / 60)).padStart(2, '0');
            const sec = String(Math.floor(this.activeAudioElement.currentTime % 60)).padStart(2, '0');
            timeText.innerText = `${min}:${sec}`;
        }, 100);

        this.activeAudioElement.onended = () => {
            this.stopCardAudioPlayback();
        };
    }

    stopCardAudioPlayback() {
        if (this.activeAudioElement) {
            this.activeAudioElement.pause();
            this.activeAudioElement = null;
        }
        clearInterval(this.audioPlayInterval);

        if (this.activeAudioBtn) {
            this.activeAudioBtn.innerHTML = '<i data-lucide="play"></i>';
            this.activeAudioProgressBar.style.width = '0%';
            this.activeAudioTime.innerText = '0:00';
        }

        this.activeAudioBtn = null;
        this.activeAudioProgressBar = null;
        this.activeAudioTime = null;
        lucide.createIcons();
    }

    // Drag helper locator
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // --- Backups Management ---
    async exportWorkspace() {
        this.sfx.playClick();
        const exportData = {
            tasks: this.tasks,
            categories: this.categories,
            theme: this.activeTheme
        };

        const str = JSON.stringify(exportData, null, 2);
        const blob = new Blob([str], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `AuraList_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importWorkspaceTrigger() {
        this.sfx.playClick();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => this.handleWorkspaceImport(e.target.files[0]);
        input.click();
    }

    handleWorkspaceImport(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.tasks || !data.categories) {
                    alert('Invalid database backup format.');
                    return;
                }

                if (confirm('Importing will replace your current workspace records. Continue?')) {
                    await this.localDb.clearAll();

                    // Save local backup copies
                    for (const cat of data.categories) {
                        await this.localDb.save('categories', cat);
                    }
                    for (const task of data.tasks) {
                        await this.localDb.save('tasks', task);
                    }
                    if (data.theme) {
                        await this.localDb.save('settings', { key: 'theme', value: data.theme });
                    }

                    // If Cloud is linked, upload them as well
                    if (this.user && this.supabase) {
                        document.getElementById('statusProgress').innerText = 'Uploading restored items to Cloud...';
                        
                        // Push Categories
                        for (const cat of data.categories) {
                            cat.user_id = this.user.id;
                            await this.supabase.from('categories').upsert(cat);
                        }

                        // Push Tasks
                        for (const task of data.tasks) {
                            task.user_id = this.user.id;
                            await this.supabase.from('tasks').upsert(task);
                        }
                    }

                    alert('Database restoration complete!');
                    window.location.reload();
                }
            } catch (err) {
                alert('Restoration Parse Failure.');
            }
        };
        reader.readAsText(file);
    }

    async clearAllData() {
        this.sfx.playClick();
        if (confirm('CRITICAL WARNING: Wipe out ALL records (Local Cache & Cloud DB)? This action cannot be reversed.')) {
            await this.localDb.clearAll();
            
            if (this.user && this.supabase) {
                document.getElementById('statusProgress').innerText = 'Wiping Cloud storage...';
                await this.supabase.from('tasks').delete().eq('user_id', this.user.id);
                await this.supabase.from('categories').delete().eq('user_id', this.user.id);
            }

            alert('System wiped successfully.');
            window.location.reload();
        }
    }
}

// Instantiate and Boot App on Page Load
window.addEventListener('DOMContentLoaded', () => {
    const app = new AuraListApp();
    app.initialize();
});
