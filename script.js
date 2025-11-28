// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js';
import { getAuth, GoogleAuthProvider, GithubAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, getDocs, deleteDoc, onSnapshot, orderBy, setDoc, updateDoc, collectionGroup, query, where, getDoc } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js';

// Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAlLPyuOkVH0Pf7gBOmoJ7FNVJ0YSbG9i8",
    authDomain: "communitypins-89698.firebaseapp.com",
    projectId: "communitypins-89698",
    storageBucket: "communitypins-89698.firebasestorage.app",
    messagingSenderId: "309453861980",
    appId: "1:309453861980:web:c9b3225c51dce34851e299",
    measurementId: "G-RE26HEV2VC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global variables
let map;
let currentLat, currentLng;
let pinModal = null;
let howToUseModal = null;
let aboutModal = null;
let selectedLatLng = null;
let debounceTimer;
let searchMarker = null; // Track temporary search marker
let currentUserId = null; // Track anonymous user ID
let currentUserFirstName = null; // Track Google user first name (if available)
let isGoogleUser = false; // whether the current signed-in user is a Google authenticated user
let isGithubUser = false; // whether the current signed-in user is a GitHub authenticated user
let isOAuthUser = false; // whether signed in with any supported OAuth provider
let authModal = null; // modal prompting sign-in
let authChoiceModal = null; // modal to choose auth provider
let pendingLatLng = null; // store attempted lat/lng when user is prompted to sign in
let selectedPinColor = '#008080'; // default pin color
let myMapsModal = null; // modal for My Maps
let activeMapId = localStorage.getItem('activeMapId') || null; // currently selected map
let activeMapName = localStorage.getItem('activeMapName') || null; // optional persisted map name
let isViewingSharedMap = false; // track if currently viewing a shared map
// Firestore listener unsubscribe handles so we can re-query when map changes
let pinsUnsubscribe = null;
let reportedUnsubscribe = null;
let dislikesUnsubscribe = null;
// Poll handle fallback for dislikes polling
let dislikesPollHandle = null;
let currentLocationStatus = ''; // base location/status text (search/center messages)

function setLocationStatus(text) {
    currentLocationStatus = text || '';
    updateLocationStatusDisplay();
}

function updateLocationStatusDisplay() {
    const el = document.getElementById('location-status');
    if (!el) return;
    if (activeMapName) {
        el.textContent = currentLocationStatus ? `${currentLocationStatus} — Map: ${activeMapName}` : `Map: ${activeMapName}`;
    } else {
        el.textContent = currentLocationStatus || '';
    }
}

// Validate latitude and longitude values
function isValidLatLng(lat, lng) {
    if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
    const nlat = Number(lat);
    const nlng = Number(lng);
    if (!isFinite(nlat) || !isFinite(nlng)) return false;
    if (nlat < -90 || nlat > 90) return false;
    if (nlng < -180 || nlng > 180) return false;
    return true;
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    console.log('App: DOMContentLoaded');
    
    // Check if user is viewing a shared map (query param ?shareMap=mapId)
    const urlParams = new URLSearchParams(window.location.search);
    const sharedMapId = urlParams.get('shareMap');
    if (sharedMapId) {
        console.log('Shared map requested:', sharedMapId);
        // Store for later processing after auth state is determined
        window._pendingSharedMapId = sharedMapId;
    }
    
    // Keep UI in sync with auth state (handles Google sign-in and sign-out)
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUserId = user.uid;
            // Save first name if available
            currentUserFirstName = user.displayName ? user.displayName.split(' ')[0] : null;
            // Determine which provider(s) the signed-in user used
            isGoogleUser = user.providerData && user.providerData.some(p => p.providerId === 'google.com');
            isGithubUser = user.providerData && user.providerData.some(p => p.providerId === 'github.com');
            isOAuthUser = !!(isGoogleUser || isGithubUser);
            
            console.log('Auth state: user signed in', { currentUserId, isOAuthUser, pendingSharedMapId: window._pendingSharedMapId });
            
            // If there's a pending shared map, load it now that user is signed in
            if (window._pendingSharedMapId) {
                console.log('Loading pending shared map:', window._pendingSharedMapId);
                loadSharedMap(window._pendingSharedMapId);
                window._pendingSharedMapId = null;
            }
        } else {
            currentUserId = null;
            currentUserFirstName = null;
            isGoogleUser = false;
            isGithubUser = false;
            isOAuthUser = false;
            
            console.log('Auth state: user signed out', { pendingSharedMapId: window._pendingSharedMapId });
            
            // If user is not signed in but there's a pending shared map, load it anyway (shared maps don't require auth)
            if (window._pendingSharedMapId) {
                console.log('Loading pending shared map (no auth required):', window._pendingSharedMapId);
                loadSharedMap(window._pendingSharedMapId);
                window._pendingSharedMapId = null;
            }
        }
        updateAuthUI();
    // If the user just signed in with any supported provider and they had a pending location, open pin modal
    if (isOAuthUser && pendingLatLng) {
            if (isValidLatLng(pendingLatLng.lat, pendingLatLng.lng)) {
                selectedLatLng = pendingLatLng;
                pendingLatLng = null;
                // ensure default color is selected in UI
                selectedPinColor = selectedPinColor || '#008080';
                updatePaletteSelectionUI();
                pinModal.style.display = 'block';
                // focus note input for convenience
                setTimeout(() => document.getElementById('note-input')?.focus(), 100);
            } else {
                // invalid pending coordinates -- drop them and inform the user
                pendingLatLng = null;
                showToast('Pending location is invalid and was discarded.');
            }
        }
        // If My Maps modal is open, refresh the list when auth changes
        try {
            if (myMapsModal && myMapsModal.style && myMapsModal.style.display === 'block') {
                loadUserMaps().catch(() => {});
            }
        } catch (e) {}
    });
    await getUserLocation();
    initMap();
    initModals();
    initSearch();
    loadPins();
    // Refresh displayed status to include selected map if any
    updateLocationStatusDisplay();
});

// Update auth button UI text
function updateAuthUI() {
    const authButton = document.getElementById('auth-button');
    if (!authButton) return;
    const user = auth.currentUser;
    if (user) {
        const provider = isGoogleUser ? '<i class="fa-brands fa-google" style="color: #ffffff;"></i>' : (isGithubUser ? '<i class="fa-brands fa-github" style="color: #ffffff;"></i>' : 'Account');
        const namePart = currentUserFirstName ? ` ${currentUserFirstName}` : '';
        authButton.innerHTML = `${provider} ${namePart}`;
    } else {
        authButton.textContent = 'Sign in';
    }
}

// Called when user clicks the auth button
async function handleAuthButtonClick() {
    const user = auth.currentUser;
    // If already signed in, sign out
    if (user) {
        try {
            await signOut(auth);
            showToast('Signed out');
        } catch (err) {
            console.error('Sign out error:', err);
            showToast('Sign out failed: ' + err.message);
        }
        return;
    }

    // Otherwise, open the auth choice modal so the user can pick a provider
    try {
        if (authChoiceModal) authChoiceModal.style.display = 'block';
        else showToast('Choose a sign-in provider.');
    } catch (err) {
        console.error('Could not open auth choice modal:', err);
        showToast('Sign-in failed: ' + (err.message || err));
    }
}

// Get user location (try browser geolocation first, fall back to IP geolocation)
async function getUserLocation() {
    // helper to wrap navigator.geolocation in a promise with timeout
    const getBrowserLocation = (timeout = 10000) => {
        return new Promise((resolve, reject) => {
            if (!('geolocation' in navigator)) {
                return reject(new Error('Geolocation not supported'));
            }
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                reject(new Error('Geolocation timed out'));
            }, timeout);

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    if (timedOut) return;
                    clearTimeout(timer);
                    resolve(pos.coords);
                },
                (err) => {
                    if (timedOut) return;
                    clearTimeout(timer);
                    reject(err);
                },
                { enableHighAccuracy: false, maximumAge: 0, timeout }
            );
        });
    };

    // try browser geolocation first
    try {
    const coords = await getBrowserLocation(10000);
    currentLat = coords.latitude;
    currentLng = coords.longitude;
    setLocationStatus(`Centered on your current location.`);
    } catch (geoError) {
        console.warn('Browser geolocation failed or denied:', geoError);

        // fallback to IP lookup
        try {
            const response = await fetch('https://ipapi.co/json/');
            const data = await response.json();
            if (data && data.latitude && data.longitude) {
                currentLat = data.latitude;
                currentLng = data.longitude;
                setLocationStatus(`Browser location access denied, approximated location may not be accurate.`);
            } else {
                throw new Error('IP geolocation returned invalid data');
            }
        } catch (ipError) {
            console.error('IP geolocation error:', ipError);
            setLocationStatus('Unable to contact geolocation server, please check your connection.');
            currentLat = 37.7749;
            currentLng = -122.4194;
        }
    }

    // update map view if map already initialized
    if (map) {
        try {
            map.setView([currentLat, currentLng], 13);
        } catch (err) {
            console.error('Error setting map view:', err);
        }
    }
}

// Initialize Leaflet map with OpenStreetMap tiles
function initMap() {
    try {
        console.log('App: initializing Leaflet map element #map with coords', currentLat, currentLng);
        map = window.L.map('map').setView([currentLat || 37.7749, currentLng || -122.4194], 13);
    } catch (err) {
        console.error('App: failed to initialize map:', err);
        // Surface a visible message in the UI so the user sees something
        const status = document.getElementById('location-status');
        if (status) status.textContent = 'Map failed to initialize — check console for errors.';
        return;
    }

    // Add OpenStreetMap tile layer
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Click to add pin and remove search marker
    map.on('click', (e) => {
        const lat = e?.latlng?.lat;
        const lng = e?.latlng?.lng;
        if (!isValidLatLng(lat, lng)) {
            showToast('Invalid location selected.');
            return;
        }

        if (!isOAuthUser) {
            // Prompt user to sign in and remember the attempted location
            pendingLatLng = { lat, lng };
            if (authModal) authModal.style.display = 'block';
            else showToast('Please sign in (Google or GitHub) to add pins.');
            return;
        }

        selectedLatLng = { lat, lng };
        // reset note and ensure a color is selected
        document.getElementById('note-input').value = '';
        selectedPinColor = selectedPinColor || '#008080';
        updatePaletteSelectionUI();
        pinModal.style.display = 'block';
        if (searchMarker) {
            map.removeLayer(searchMarker); // Remove temporary search marker
            searchMarker = null;
        }
    });
}

// Initialize modals and center button
function initModals() {
    pinModal = document.getElementById('pin-modal');
    howToUseModal = document.getElementById('how-to-use-modal');
    aboutModal = document.getElementById('about-modal');
    authModal = document.getElementById('auth-required-modal');
    myMapsModal = document.getElementById('my-maps-modal');

    // Pin modal
    document.querySelector('#pin-modal .close').onclick = () => { pinModal.style.display = 'none'; };
    document.getElementById('cancel-pin').onclick = () => { pinModal.style.display = 'none'; };
    document.getElementById('save-pin').onclick = savePin;

    // How to Use modal
    document.querySelector('#how-to-use-modal .close').onclick = () => { howToUseModal.style.display = 'none'; };
    document.querySelector('.close-how-to-use').onclick = () => { howToUseModal.style.display = 'none'; };
    document.getElementById('how-to-use-button').onclick = () => { howToUseModal.style.display = 'block'; };

    // About modal
    document.querySelector('#about-modal .close').onclick = () => { aboutModal.style.display = 'none'; };
    document.querySelector('.close-about').onclick = () => { aboutModal.style.display = 'none'; };
    document.getElementById('about-button').onclick = () => { aboutModal.style.display = 'block'; };

    // Center button
    document.getElementById('center-button').onclick = async () => {
        await getUserLocation();
    };

    // Try Community Pins button (shared map header)
    const tryPinsButton = document.getElementById('try-community-pins-button');
    if (tryPinsButton) {
        tryPinsButton.addEventListener('click', () => {
            // Clear shared map state and return to public map
            isViewingSharedMap = false;
            activeMapId = null;
            activeMapName = null;
            localStorage.removeItem('activeMapId');
            localStorage.removeItem('activeMapName');
            
            // Update UI and reload
            updateSharedMapUI();
            updateLocationStatusDisplay();
            try { loadPins(); } catch (e) { console.warn('Failed to reload pins:', e); }
            try { if (window._updateExpiryVisibility) window._updateExpiryVisibility(); } catch (e) {}
            
            // Remove query params from URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
            showToast('Viewing public Community Pins map');

            window.location.reload();
        });
    }

    // Auth button (sign-in / sign-out)
    const authButton = document.getElementById('auth-button');
    if (authButton) {
        authButton.addEventListener('click', handleAuthButtonClick);
    }

    // Auth-required modal buttons
    if (authModal) {
        const closeAuth = document.querySelector('.close-auth-required');
        if (closeAuth) closeAuth.onclick = () => { authModal.style.display = 'none'; pendingLatLng = null; };
        const signinBtn = document.getElementById('auth-required-signin');
        const cancelBtn = document.getElementById('auth-required-cancel');
        if (signinBtn) signinBtn.addEventListener('click', () => {
            // trigger the same sign-in flow as the top-level auth button
            handleAuthButtonClick();
            authModal.style.display = 'none';
        });
        if (cancelBtn) cancelBtn.addEventListener('click', () => { authModal.style.display = 'none'; pendingLatLng = null; });
    }
    // My Maps modal
    const myMapsButton = document.getElementById('my-maps-button');
    if (myMapsButton) {
        myMapsButton.addEventListener('click', openMyMapsModal);
    }
    // Auth-choice modal: wire Google / GitHub provider buttons
    authChoiceModal = document.getElementById('auth-choice-modal');
    const authChoiceClose = document.querySelector('.close-auth-choice');
    if (authChoiceClose) authChoiceClose.onclick = () => { if (authChoiceModal) authChoiceModal.style.display = 'none'; };
    const authChoiceGoogle = document.getElementById('auth-choice-google');
    const authChoiceGithub = document.getElementById('auth-choice-github');
    if (authChoiceGoogle) {
        authChoiceGoogle.addEventListener('click', async () => {
            const user = auth.currentUser;
            if (user) { showToast('Please sign out first.'); return; }
            const provider = new GoogleAuthProvider();
            try {
                const result = await signInWithPopup(auth, provider);
                showToast(`Signed in as ${result.user.displayName || 'user'}`);
            } catch (err) {
                console.error('Sign-in error:', err);
                showToast('Sign-in failed: ' + (err.message || err));
            } finally {
                if (authChoiceModal) authChoiceModal.style.display = 'none';
            }
        });
    }
    if (authChoiceGithub) {
        authChoiceGithub.addEventListener('click', async () => {
            const user = auth.currentUser;
            if (user) { showToast('Please sign out first.'); return; }
            const provider = new GithubAuthProvider();
            try {
                const result = await signInWithPopup(auth, provider);
                showToast(`Signed in as ${result.user.displayName || 'GitHub user'}`);
            } catch (err) {
                console.error('GitHub sign-in error:', err);
                showToast('GitHub sign-in failed: ' + (err.message || err));
            } finally {
                if (authChoiceModal) authChoiceModal.style.display = 'none';
            }
        });
    }
    if (myMapsModal) {
        const closeMyMaps = document.querySelector('.close-my-maps');
        if (closeMyMaps) closeMyMaps.onclick = () => { myMapsModal.style.display = 'none'; };
        const createBtn = document.getElementById('create-map-button');
        if (createBtn) createBtn.addEventListener('click', createUserMap);
        const deactivateBtn = document.getElementById('deactivate-map-button');
        if (deactivateBtn) deactivateBtn.addEventListener('click', deactivateActiveMap);
        // allow pressing Enter in the new-map-name input to create
        const newMapInput = document.getElementById('new-map-name');
        if (newMapInput) {
            newMapInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createUserMap(); });
        }
    }
    // Ensure deactivate button reflects current state on init
    try { updateDeactivateButtonVisibility(); } catch (e) {}
    // Initialize color palette buttons
    const paletteEl = document.getElementById('color-palette');
    const colors = ['#008080', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#8E8E93'];
    if (paletteEl) {
        paletteEl.innerHTML = '';
        colors.forEach((c) => {
            const btn = document.createElement('button');
            btn.className = 'color-swatch';
            btn.type = 'button';
            btn.dataset.color = c;
            btn.style.background = c;
            btn.title = c;
            btn.addEventListener('click', () => {
                selectedPinColor = c;
                updatePaletteSelectionUI();
            });
            paletteEl.appendChild(btn);
        });
        // initial selection
        updatePaletteSelectionUI();
    }

    // Expiry slider in pin modal (1-7 days)
    const expirySlider = document.getElementById('expiry-slider');
    const expiryDisplay = document.getElementById('expiry-display');
    const expiryContainer = document.getElementById('expiry-slider-container');
    if (expirySlider && expiryDisplay && expiryContainer) {
        expiryDisplay.textContent = expirySlider.value;
        expirySlider.addEventListener('input', () => {
            expiryDisplay.textContent = expirySlider.value;
        });
        // Hide expiry slider when a private map is active (pins on private maps don't expire)
        const updateExpiryVisibility = () => {
            expiryContainer.style.display = activeMapId ? 'none' : 'block';
        };
        updateExpiryVisibility();
        // Store original function to call after map changes
        window._updateExpiryVisibility = updateExpiryVisibility;
    }
}

function updatePaletteSelectionUI() {
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(s => {
        if (s.dataset.color === selectedPinColor) s.classList.add('selected');
        else s.classList.remove('selected');
    });
}

// --- My Maps: load/create/delete/select user maps ---
async function openMyMapsModal() {
    if (!isOAuthUser) {
        if (authModal) authModal.style.display = 'block';
        else showToast('Please sign in (Google or GitHub) to manage your maps.');
        return;
    }
    if (!myMapsModal) return;
    myMapsModal.style.display = 'block';
    await loadUserMaps();
}

// Generate a short shareable link for a map (format: ?shareMap=mapId)
function generateShareLink(mapId) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?shareMap=${mapId}`;
}

// Show the share link input and copy button for a map
function showShareLink(mapId) {
    const shareLinkSection = document.getElementById('share-link-section');
    const shareLinkInput = document.getElementById('share-link-input');
    const copyButton = document.getElementById('copy-share-link-button');
    
    if (!shareLinkSection || !shareLinkInput) return;
    
    // Mark the map as shared in Firestore if not already shared
    markMapAsShared(mapId);
    
    const shareLink = generateShareLink(mapId);
    shareLinkInput.value = shareLink;
    shareLinkSection.style.display = 'block';
    
    if (copyButton) {
        copyButton.onclick = () => {
            shareLinkInput.select();
            document.execCommand('copy');
            showToast('Share link copied to clipboard!');
        };
    }
}

// Mark a map as shared (isShared=true) so logged-out users can access it
async function markMapAsShared(mapId) {
    try {
        console.log('markMapAsShared: attempting to mark', mapId, 'as shared, currentUserId:', currentUserId);
        const mapRef = doc(db, 'userMaps', mapId);
        await updateDoc(mapRef, { isShared: true });
        console.log('Map marked as shared:', mapId);
    } catch (error) {
        console.error('Error marking map as shared:', error);
        console.error('Error code:', error.code);
        if (error.code === 'permission-denied') {
            console.warn('Permission denied when marking map as shared - user may not be owner or not signed in');
        }
    }
}

// Load a shared map by ID
async function loadSharedMap(mapId) {
    try {
        console.log('loadSharedMap:', mapId, 'currentUserId:', currentUserId);
        // Fetch the map metadata
        const mapRef = doc(db, 'userMaps', mapId);
        const mapSnap = await getDoc(mapRef);
        
        console.log('Shared map document exists:', mapSnap.exists());
        if (mapSnap.exists()) {
            console.log('Shared map data:', mapSnap.data());
        }
        
        if (!mapSnap.exists()) {
            showToast('Shared map not found.');
            return;
        }
        
        const mapData = mapSnap.data();
        
        // Mark as viewing a shared map and simplify UI
        isViewingSharedMap = true;
        updateSharedMapUI();
        
        // Set active map and load pins
        setActiveMap(mapId, mapData.name || 'Shared Map');
        
        // After a short delay, fit map to all pins
        setTimeout(() => {
            fitMapToAllPins();
        }, 500);
    } catch (error) {
        console.error('Error loading shared map:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        if (error.code === 'permission-denied') {
            showToast('Permission denied. This shared map is not accessible.');
        } else {
            showToast('Unable to load shared map. Please check the link.');
        }
    }
}

// Fit map view to show all pins with some padding
function fitMapToAllPins() {
    if (!map || !window._pinsCache || window._pinsCache.length === 0) {
        console.log('No pins to fit map to');
        return;
    }
    
    try {
        // Create bounds from all pins
        const bounds = window.L.latLngBounds([]);
        let hasPins = false;
        
        window._pinsCache.forEach(({ data }) => {
            if (data && data.lat && data.lng) {
                bounds.extend([data.lat, data.lng]);
                hasPins = true;
            }
        });
        
        if (hasPins) {
            console.log('Fitting map to pins bounds:', bounds);
            // Fit the map to the bounds with padding
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    } catch (error) {
        console.warn('Error fitting map to pins:', error);
    }
}

// Update UI to simplify interface for shared map viewing
function updateSharedMapUI() {
    const sharedMapHeader = document.getElementById('shared-map-header');
    const searchContainer = document.getElementById('search-container');
    const myMapsButton = document.getElementById('my-maps-button');
    const authButton = document.getElementById('auth-button');
    const howToButton = document.getElementById('how-to-use-button');
    const aboutButton = document.getElementById('about-button');
    const centerButton = document.getElementById('center-button');

    if (isViewingSharedMap) {
        // Set location status
        setLocationStatus('Viewing a publically shared map');
        // Show shared map header
        if (sharedMapHeader) sharedMapHeader.style.display = 'block';
        
        // Hide search bar
        if (searchContainer) searchContainer.style.display = 'none';
        
        // Hide user-specific buttons
        if (myMapsButton) myMapsButton.style.display = 'none';
        if (authButton) authButton.style.display = 'none';
        if (howToButton) howToButton.style.display = 'none';
        if (aboutButton) aboutButton.style.display = 'none';
        if (centerButton) centerButton.style.display = 'none';
    } else {
        // Hide shared map header
        if (sharedMapHeader) sharedMapHeader.style.display = 'none';
        
        // Show search bar
        if (searchContainer) searchContainer.style.display = 'block';
        
        // Show user-specific buttons
        if (myMapsButton) myMapsButton.style.display = 'inline-block';
        if (authButton) authButton.style.display = 'inline-block';
        if (howToButton) howToButton.style.display = 'inline-block';
        if (aboutButton) aboutButton.style.display = 'inline-block';
    }
}

async function loadUserMaps() {
    const listEl = document.getElementById('my-maps-list');
    const createInput = document.getElementById('new-map-name');
    if (!listEl) return;
    listEl.innerHTML = '<li style="color:#666;">Loading...</li>';
    try {
        console.log('loadUserMaps: currentUserId=', currentUserId, 'isOAuthUser=', isOAuthUser);
        // Query only maps owned by the current user (rules require this)
        const q = query(collection(db, 'userMaps'), where('ownerId', '==', currentUserId));
        const snap = await getDocs(q);
        const docs = [];
        snap.forEach((d) => { docs.push({ id: d.id, data: d.data() }); });
        // sort by createdAt desc (handle Firestore Timestamps and JS Dates)
        docs.sort((a, b) => {
            const toMillis = (val) => {
                if (!val) return 0;
                try {
                    if (typeof val.toDate === 'function') return val.toDate().getTime();
                    if (val instanceof Date) return val.getTime();
                    const n = Number(val);
                    if (!isNaN(n)) return n;
                } catch (e) {
                    // fallback
                }
                return 0;
            };
            return toMillis(b.data.createdAt) - toMillis(a.data.createdAt);
        });
        if (docs.length === 0) {
            listEl.innerHTML = '<li style="color:#666;">No maps yet. Create one using the + button.</li>';
        } else {
            listEl.innerHTML = '';
            docs.forEach((m) => {
                const li = document.createElement('li');
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.alignItems = 'center';
                li.style.padding = '6px 4px';
                li.style.borderBottom = '1px solid #eee';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = m.data.name || '(untitled)';
                nameSpan.style.cursor = 'pointer';
                nameSpan.addEventListener('click', () => {
                    setActiveMap(m.id, m.data.name);
                    // close modal after selection
                    if (myMapsModal) myMapsModal.style.display = 'none';
                });

                const actions = document.createElement('span');
                actions.style.display = 'flex';
                actions.style.gap = '6px';

                const selectIndicator = document.createElement('small');
                selectIndicator.style.color = '#007AFF';
                selectIndicator.style.marginRight = '6px';
                if (activeMapId === m.id) {
                    selectIndicator.textContent = 'Active';
                    // ensure active map name is set so the status line can show it
                    activeMapName = m.data.name || null;
                    if (activeMapName) localStorage.setItem('activeMapName', activeMapName);
                    updateLocationStatusDisplay();
                }

                const delBtn = document.createElement('button');
                delBtn.textContent = 'Delete';
                delBtn.style.background = '#FF3B30';
                delBtn.style.color = 'white';
                delBtn.style.border = 'none';
                delBtn.style.padding = '4px 8px';
                delBtn.style.borderRadius = '4px';
                delBtn.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    await deleteUserMap(m.id, m.data.name);
                });

                const shareBtn = document.createElement('button');
                shareBtn.textContent = 'Share';
                shareBtn.style.background = '#34C759';
                shareBtn.style.color = 'white';
                shareBtn.style.border = 'none';
                shareBtn.style.padding = '4px 8px';
                shareBtn.style.borderRadius = '4px';
                shareBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    showShareLink(m.id);
                });

                actions.appendChild(selectIndicator);
                actions.appendChild(shareBtn);
                actions.appendChild(delBtn);

                li.appendChild(nameSpan);
                li.appendChild(actions);
                listEl.appendChild(li);
            });
        }
        // update deactivate button visibility
        updateDeactivateButtonVisibility();
        // clear create input
        if (createInput) createInput.value = '';
    } catch (err) {
        console.error('Failed to load user maps:', err);
        listEl.innerHTML = '<li style="color:#c62828;">Failed to load maps.</li>';
    }
}

function updateDeactivateButtonVisibility() {
    const btn = document.getElementById('deactivate-map-button');
    if (!btn) return;
    if (activeMapId) {
        btn.style.display = 'inline-block';
        btn.style.background = '#FFCC00';
        btn.style.color = '#000';
    } else {
        btn.style.display = 'none';
    }
}

function deactivateActiveMap() {
    if (!activeMapId) {
        showToast('No active map to deactivate.');
        return;
    }
    const ok = window.confirm('Deactivate the currently selected map?');
    if (!ok) return;
    activeMapId = null;
    activeMapName = null;
    localStorage.removeItem('activeMapId');
    localStorage.removeItem('activeMapName');
    updateDeactivateButtonVisibility();
    updateLocationStatusDisplay();
    showToast('Map deactivated');
    // refresh list so 'Active' indicators update
    if (myMapsModal && myMapsModal.style.display === 'block') loadUserMaps().catch(() => {});
    // reload pins so we return to the public feed
    try { loadPins(); } catch (e) { console.warn('Failed to reload pins after deactivation:', e); }
    // Show expiry slider again since we're back to public
    try { if (window._updateExpiryVisibility) window._updateExpiryVisibility(); } catch (e) {}
}

async function createUserMap() {
    if (!isOAuthUser) {
        if (authModal) authModal.style.display = 'block';
        else showToast('Please sign in (Google or GitHub) to create maps.');
        return;
    }
    const input = document.getElementById('new-map-name');
    if (!input) return;
    const name = input.value.trim();
    if (!name) { showToast('Enter a name for the map.'); return; }
    if (name.length > 50) { showToast('Map name too long (50 char max).'); return; }
    try {
        // enforce max 8 maps
    // count existing maps owned by the user using a filtered query
    const countQ = query(collection(db, 'userMaps'), where('ownerId', '==', currentUserId));
    const snap = await getDocs(countQ);
    let count = snap.size;
        if (count >= 8) { showToast('You have reached the 8-map limit. Delete an existing map to create a new one.'); return; }

        await addDoc(collection(db, 'userMaps'), {
            ownerId: currentUserId,
            name,
            createdAt: new Date()
        });
        showToast('Map created');
        await loadUserMaps();
    } catch (err) {
        console.error('Failed to create map:', err);
        showToast('Failed to create map: ' + (err.message || err));
    }
}

async function deleteUserMap(mapId, mapName) {
    if (!mapId) return;
    const ok = window.confirm(`Delete map "${mapName || ''}"? This cannot be undone.`);
    if (!ok) return;
    try {
        await deleteDoc(doc(db, 'userMaps', mapId));
        showToast('Map deleted');
        if (activeMapId === mapId) {
            activeMapId = null;
            activeMapName = null;
            localStorage.removeItem('activeMapId');
            localStorage.removeItem('activeMapName');
            updateLocationStatusDisplay();
            // reload pins since active map was deleted
            try { loadPins(); } catch (e) { console.warn('Failed to reload pins after map deletion:', e); }
        }
        await loadUserMaps();
    } catch (err) {
        console.error('Failed to delete map:', err);
        showToast('Failed to delete map: ' + (err.message || err));
    }
}

function setActiveMap(mapId, mapName) {
    activeMapId = mapId;
    activeMapName = mapName || null;
    if (mapId) {
        localStorage.setItem('activeMapId', mapId);
        if (activeMapName) localStorage.setItem('activeMapName', activeMapName);
    } else {
        localStorage.removeItem('activeMapId');
        localStorage.removeItem('activeMapName');
    }
    updateLocationStatusDisplay();
    showToast(mapName ? `Selected map: ${mapName}` : 'Map selected');
    updateDeactivateButtonVisibility();
    // Re-load pins to reflect the selected map (unsubscribe/resubscribe)
    try { loadPins(); } catch (e) { console.warn('Failed to reload pins after setActiveMap:', e); }
    // Hide/show expiry slider based on whether we're on a private map
    try { if (window._updateExpiryVisibility) window._updateExpiryVisibility(); } catch (e) {}
}

// small helper: return a divIcon for a pin colored with the provided color
function getPinIcon(color = '#008080') {
    return window.L.divIcon({
        className: 'pin-marker',
        html: `<div style="background:${color}; width:20px; height:20px; border-radius:50%; border:2px solid white; box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -10]
    });
}

function getReportedIcon(color = '#008080') {
    return window.L.divIcon({
        className: 'pin-marker-reported',
        html: `<div style="background:${color}; width:20px; height:20px; border-radius:50%; border:3px dashed #c62828; box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -10]
    });
}

// Move a pin from 'pins' collection to 'reported' collection and add report metadata
async function reportPin(pinId, pinData, reportNote = '') {
    if (!pinId || !pinData) throw new Error('Invalid pin');
    // create reported doc (copy original data + metadata)
    const reportedDoc = {
        ...pinData,
        originalId: pinId,
        reportedById: currentUserId || null,
        reportedByFirstName: currentUserFirstName || null,
        reportNote: reportNote || '',
        reportedAt: new Date()
    };

    // Save to 'reported'
    const reportedRef = await addDoc(collection(db, 'reported'), reportedDoc);
    // Attempt to delete the original pin. If delete fails (permissions), fall back
    // to marking it reported so moderators can see it.
    try {
        await deleteDoc(doc(db, 'pins', pinId));
    } catch (err) {
        console.warn('Could not delete original pin (permissions), attempting to mark reported instead:', err);
        try {
            const pinRef = doc(db, 'pins', pinId);
            await updateDoc(pinRef, {
                reported: true,
                reportedRefId: reportedRef.id,
                reportedAt: reportedDoc.reportedAt
            });
        } catch (err2) {
            console.warn('Could not mark original pin as reported either:', err2);
            // still return reportedRef id; moderators can review reported collection
        }
    }

    return reportedRef.id;
}

// Debounce function to limit API calls
function debounce(func, wait) {
    return function (...args) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(this, args), wait);
    };
}

// Custom icon for temporary search marker
const searchIcon = window.L.divIcon({
    className: 'search-marker',
    html: '<div style="background-color: #008080; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10]
});

// Initialize search and autocomplete
function initSearch() {
    const searchButton = document.getElementById('search-button');
    const searchInput = document.getElementById('search-input');
    const autocompleteResults = document.getElementById('autocomplete-results');

    // Search button click
    searchButton.addEventListener('click', async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showToast('Please enter a location to search.');
            return;
        }
        await performSearch(query);
        autocompleteResults.style.display = 'none';
    });

    // Enter key for search
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchButton.click();
        }
    });

    // Autocomplete on input
    searchInput.addEventListener('input', debounce(async () => {
        const query = searchInput.value.trim();
        if (query.length < 3) {
            autocompleteResults.style.display = 'none';
            autocompleteResults.innerHTML = '';
            return;
        }

        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`);
            const data = await response.json();
            autocompleteResults.innerHTML = '';
            if (data.length > 0) {
                data.forEach((item) => {
                    const li = document.createElement('li');
                    li.textContent = item.display_name;
                    li.addEventListener('click', () => {
                        searchInput.value = item.display_name;
                        map.setView([parseFloat(item.lat), parseFloat(item.lon)], 13);
                        setLocationStatus(`Showing: ${item.display_name}`);
                        // Add temporary search marker with "Place a pin here" button
                        if (searchMarker) {
                            map.removeLayer(searchMarker); // Remove previous marker
                        }
                        const lat = parseFloat(item.lat);
                        const lon = parseFloat(item.lon);
                        searchMarker = window.L.marker([lat, lon], { icon: searchIcon })
                            .addTo(map)
                            .bindPopup(`
                                <strong>${item.display_name}</strong><br>
                                <button class="place-pin-button" data-lat="${lat}" data-lng="${lon}">Place a pin here</button>
                            `)
                            .openPopup();
                        // Attach handler when popup opens so we operate on the popup DOM
                        searchMarker.on('popupopen', () => {
                            try {
                                const popupEl = searchMarker.getPopup().getElement();
                                if (popupEl) {
                                    // Make sure clicks inside the popup don't propagate to the map
                                    if (window.L && window.L.DomEvent && typeof window.L.DomEvent.disableClickPropagation === 'function') {
                                        window.L.DomEvent.disableClickPropagation(popupEl);
                                    }
                                    const placeButton = popupEl.querySelector('.place-pin-button');
                                    if (placeButton) {
                                        placeButton.addEventListener('click', (ev) => {
                                            ev.stopPropagation();
                                            ev.preventDefault();
                                            // Validate coordinates
                                            if (!isValidLatLng(lat, lon)) {
                                                showToast('Invalid location coordinates; cannot place pin.');
                                                return;
                                            }
                                            // If not signed in with Google, prompt and store pending lat/lng
                                            if (!isOAuthUser) {
                                                pendingLatLng = { lat, lng: lon };
                                                if (authModal) authModal.style.display = 'block';
                                                else showToast('Please sign in (Google or GitHub) to add pins.');
                                                return;
                                            }
                                            selectedLatLng = { lat, lng: lon };
                                            document.getElementById('note-input').value = '';
                                            selectedPinColor = selectedPinColor || '#008080';
                                            updatePaletteSelectionUI();
                                            pinModal.style.display = 'block';
                                            if (searchMarker) {
                                                map.removeLayer(searchMarker); // Remove temporary marker
                                                searchMarker = null;
                                            }
                                        });
                                    }
                                }
                            } catch (e) {
                                console.error('Error attaching place-pin handler (autocomplete):', e);
                            }
                        });
                        autocompleteResults.style.display = 'none';
                        autocompleteResults.innerHTML = '';
                    });
                    autocompleteResults.appendChild(li);
                });
                autocompleteResults.style.display = 'block';
            } else {
                autocompleteResults.style.display = 'none';
            }
        } catch (error) {
            console.error('Autocomplete error:', error);
            autocompleteResults.style.display = 'none';
        }
    }, 300));

    // Hide autocomplete when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !autocompleteResults.contains(e.target)) {
            autocompleteResults.style.display = 'none';
        }
    });
}

// Perform search
async function performSearch(query) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data.length > 0) {
            const { lat, lon, display_name } = data[0];
            map.setView([parseFloat(lat), parseFloat(lon)], 13);
            setLocationStatus(`Showing: ${display_name}`);
            // Add temporary search marker with "Place a pin here" button
            if (searchMarker) {
                map.removeLayer(searchMarker); // Remove previous marker
            }
            const parsedLat = parseFloat(lat);
            const parsedLon = parseFloat(lon);
            searchMarker = window.L.marker([parsedLat, parsedLon], { icon: searchIcon })
                .addTo(map)
                .bindPopup(`
                    <strong>${display_name}</strong><br>
                    <button class="place-pin-button" data-lat="${parsedLat}" data-lng="${parsedLon}">Place a pin here</button>
                `)
                .openPopup();
            // Attach handler on popup open and disable click propagation so the
            // button click is reliably handled (avoids popup closing before handler runs).
            searchMarker.on('popupopen', () => {
                try {
                    const popupEl = searchMarker.getPopup().getElement();
                    if (popupEl) {
                        if (window.L && window.L.DomEvent && typeof window.L.DomEvent.disableClickPropagation === 'function') {
                            window.L.DomEvent.disableClickPropagation(popupEl);
                        }
                        const placeButton = popupEl.querySelector('.place-pin-button');
                        if (placeButton) {
                            placeButton.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                // Validate coordinates
                                if (!isValidLatLng(parsedLat, parsedLon)) {
                                    showToast('Invalid location coordinates; cannot place pin.');
                                    return;
                                }
                                if (!isOAuthUser) {
                                    pendingLatLng = { lat: parsedLat, lng: parsedLon };
                                    if (authModal) authModal.style.display = 'block';
                                    else showToast('Please sign in (Google or GitHub) to add or report pins.');
                                    return;
                                }
                                selectedLatLng = { lat: parsedLat, lng: parsedLon };
                                document.getElementById('note-input').value = '';
                                pinModal.style.display = 'block';
                                if (searchMarker) {
                                    map.removeLayer(searchMarker); // Remove temporary marker
                                    searchMarker = null;
                                }
                            });
                        }
                    }
                } catch (e) {
                    console.error('Error attaching place-pin handler (search):', e);
                }
            });
        } else {
            showToast('Location not found. Try a different query.');
        }
    } catch (error) {
        console.error('Search error:', error);
        showToast('Failed to search location: ' + error.message);
    }
}

// Toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.background = '#d32f2f';
    toast.style.color = 'white';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '1000';
    toast.style.fontSize = '14px';
    toast.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Toggle heart for a pin
async function toggleHeart(pinId, currentCount, isHearted) {
    if (!isOAuthUser) {
        showToast('Please sign in (Google or GitHub) to like pins.');
        return;
    }
    if (!pinId || typeof pinId !== 'string' || pinId.trim() === '') {
        console.error('Invalid pinId:', pinId);
        showToast('Invalid pin ID. Cannot toggle heart.');
        return;
    }

    try {
        console.log(`Toggling heart for pin ${pinId}, user ${currentUserId}, isHearted: ${isHearted}`);
    const heartRef = doc(collection(db, 'pins', pinId, 'hearts'), currentUserId);
        const newHeartedState = !isHearted;
        const newHeartCount = isHearted ? currentCount - 1 : currentCount + 1;

        if (isHearted) {
            // Remove heart
            await deleteDoc(heartRef);
            console.log(`Heart removed for pin ${pinId} by user ${currentUserId}`);
        } else {
            // Add heart
            await setDoc(heartRef, {
                userId: currentUserId,
                timestamp: new Date()
            });
            console.log(`Heart added for pin ${pinId} by user ${currentUserId}`);
        }

        // Update the cached heartCount in the pin document for faster future loads
        try {
            const pinRef = doc(db, 'pins', pinId);
            await updateDoc(pinRef, { heartCount: newHeartCount });
        } catch (error) {
            console.warn('Could not update heartCount cache:', error);
        }

        // Update the open popup's heart button and count
        // Update UI elements specifically by selector to avoid collisions with dislike buttons
        const heartButton = document.querySelector(`.heart-button[data-pin-id="${pinId}"]`);
        if (heartButton) {
            heartButton.textContent = newHeartedState ? '♥' : '♡';
            heartButton.dataset.hearted = newHeartedState;
            const heartCountElement = document.querySelector(`.heart-count[data-pin-id="${pinId}"]`);
            if (heartCountElement) heartCountElement.textContent = `(${newHeartCount})`;
            const popupElement = heartButton.closest('.leaflet-popup-content');
            if (popupElement) {
                const heartSection = popupElement.querySelector('.heart-section');
                if (heartSection) {
                    if (newHeartedState) heartSection.classList.add('hearted');
                    else heartSection.classList.remove('hearted');
                }
            }
        }
    } catch (error) {
        console.error('Error toggling heart:', error, 'Pin ID:', pinId, 'User ID:', currentUserId);
        showToast('Failed to toggle heart: ' + error.message);
    }
}

// Toggle dislike for a pin (mirrors heart logic)
async function toggleDislike(pinId, currentCount, isDisliked) {
    if (!isOAuthUser) {
        showToast('Please sign in (Google or GitHub) to dislike pins.');
        return;
    }
    if (!pinId || typeof pinId !== 'string' || pinId.trim() === '') {
        console.error('Invalid pinId for dislike:', pinId);
        showToast('Invalid pin ID. Cannot toggle dislike.');
        return;
    }

    try {
        console.log(`Toggling dislike for pin ${pinId}, user ${currentUserId}, isDisliked: ${isDisliked}`);
        const dislikeRef = doc(collection(db, 'pins', pinId, 'dislikes'), currentUserId);
        const newDislikedState = !isDisliked;
        const newDislikeCount = isDisliked ? currentCount - 1 : currentCount + 1;

        if (isDisliked) {
            // Remove dislike
            await deleteDoc(dislikeRef);
            console.log(`Dislike removed for pin ${pinId} by user ${currentUserId}`);
        } else {
            // Add dislike
            await setDoc(dislikeRef, {
                userId: currentUserId,
                timestamp: new Date()
            });
            console.log(`Dislike added for pin ${pinId} by user ${currentUserId}`);
        }

        // Update the cached dislikeCount in the pin document for faster future loads
        try {
            const pinRef = doc(db, 'pins', pinId);
            await updateDoc(pinRef, { dislikeCount: newDislikeCount });
        } catch (error) {
            console.warn('Could not update dislikeCount cache:', error);
        }

        // Update UI
        const dislikeButton = document.querySelector(`.dislike-button[data-pin-id="${pinId}"]`);
        if (dislikeButton) {
            dislikeButton.textContent = newDislikedState ? '👎' : '👎'; // keep same glyph but toggle a data attribute
            dislikeButton.dataset.disliked = newDislikedState;
            dislikeButton.setAttribute('aria-pressed', newDislikedState ? 'true' : 'false');
            const dislikeCountElement = document.querySelector(`.dislike-count[data-pin-id="${pinId}"]`);
            if (dislikeCountElement) dislikeCountElement.textContent = `(${newDislikeCount})`;
            const popupElement = dislikeButton.closest('.leaflet-popup-content');
            if (popupElement) {
                const dislikeSection = popupElement.querySelector('.heart-section');
                if (dislikeSection) {
                    if (newDislikedState) dislikeSection.classList.add('disliked');
                    else dislikeSection.classList.remove('disliked');
                }
            }
        }
    } catch (error) {
        console.error('Error toggling dislike:', error, 'Pin ID:', pinId, 'User ID:', currentUserId);
        showToast('Failed to toggle dislike: ' + error.message);
    }
}

// Save pin to Firestore
async function savePin() {
    if (!selectedLatLng) return;
    if (!isOAuthUser) {
        showToast('Please sign in (Google or GitHub) to add pins.');
        return;
    }

    // Validate coordinates again before saving
    const slat = selectedLatLng.lat;
    const slng = selectedLatLng.lng;
    if (!isValidLatLng(slat, slng)) {
        showToast('Cannot save pin: invalid coordinates.');
        return;
    }

    const note = document.getElementById('note-input').value.trim();
    if (note.length > 100) return; // Enforced by maxlength, but double-check

    try {
        // Read expiry days from the modal slider (default to 7 days)
        // If on a private map, pins don't expire (set to far future or null)
        let expiresAt = null;
        if (activeMapId) {
            // Private map: pins don't expire, set to year 2999
            expiresAt = new Date('2999-12-31');
        } else {
            // Public map: use slider value
            const expiryDays = parseInt(document.getElementById('expiry-slider')?.value || '7', 10);
            expiresAt = new Date(Date.now() + (expiryDays * 24 * 60 * 60 * 1000));
        }

        const pinRef = await addDoc(collection(db, 'pins'), {
            lat: selectedLatLng.lat,
            lng: selectedLatLng.lng,
            note: note || '',
            timestamp: new Date(),
            // associate pin with currently active map if any
            mapId: activeMapId || null,
            expiresAt: expiresAt,
            createdById: currentUserId || null,
            createdByFirstName: currentUserFirstName || null,
            color: selectedPinColor || '#008080',
            // Initialize cached reaction counts for fast loading
            heartCount: 0,
            dislikeCount: 0
        });
        console.log('Pin saved with ID:', pinRef.id);
        pinModal.style.display = 'none';
        selectedLatLng = null;
    } catch (error) {
        console.error('Error saving pin:', error);
        showToast('Failed to save pin: ' + error.message);
    }
}

// Load and display pins (real-time listener)
function loadPins() {
    // If we already have active listeners, unsubscribe them so we can re-query
    try { if (pinsUnsubscribe) { pinsUnsubscribe(); pinsUnsubscribe = null; } } catch (e) { console.warn('Error unsubscribing pins listener:', e); }
    try { if (reportedUnsubscribe) { reportedUnsubscribe(); reportedUnsubscribe = null; } } catch (e) { console.warn('Error unsubscribing reported listener:', e); }
    try { if (dislikesUnsubscribe) { dislikesUnsubscribe(); dislikesUnsubscribe = null; } } catch (e) { console.warn('Error unsubscribing dislikes listener:', e); }
    try { if (dislikesPollHandle) { clearInterval(dislikesPollHandle); dislikesPollHandle = null; } } catch (e) { /* ignore */ }

    // Maintain in-memory caches for pins and reported docs and render them together
    window._pinsCache = [];
    window._reportedCache = [];

        // Helper to render both caches into a single marker layer so reported and
        // non-reported pins look identical.
        function renderAllMarkers() {
            if (window.markerLayer) {
                window.markerLayer.clearLayers();
            } else {
                window.markerLayer = window.L.layerGroup().addTo(map);
            }

            // Render normal pins (skip those marked reported)
            window._pinsCache.forEach(({ pinId, data, heartCount, isHearted, dislikeCount, isDisliked }) => {
                if (data.reported) return; // skip reported ones
                
                // When viewing public (no active map), skip pins that belong to a private map
                if (!activeMapId && data.mapId) {
                    return; // skip private map pins when in public view
                }
                
                const marker = window.L.marker([data.lat, data.lng], { icon: getPinIcon(data.color || '#008080') }).addTo(window.markerLayer);
                const heartButtonHtml = `
                    <button class="heart-button" data-pin-id="${pinId}" data-hearted="${isHearted}">
                        ${isHearted ? '♥' : '♡'}
                    </button>
                    <span class="heart-count" data-pin-id="${pinId}">(${heartCount})</span>
                    <button class="dislike-button" data-pin-id="${pinId}" data-disliked="${isDisliked}" aria-pressed="${isDisliked ? 'true' : 'false'}">👎</button>
                    <span class="dislike-count" data-pin-id="${pinId}">(${dislikeCount})</span>
                    <button class="report-button" data-pin-id="${pinId}">Report</button>
                `;
                const addedBy = data.createdByFirstName || 'Anonymous';
                let addedAt = '';
                // Compute expiry display
                let expiryHtml = '';
                try {
                    if (data && data.expiresAt) {
                        const exp = (typeof data.expiresAt.toDate === 'function') ? data.expiresAt.toDate() : new Date(data.expiresAt);
                        const now = new Date();
                        const msPerDay = 24 * 60 * 60 * 1000;
                        const daysLeft = Math.ceil((exp - now) / msPerDay);
                        if (daysLeft > 1) expiryHtml = `<small>Expires in: ${daysLeft} days</small><br>`;
                        else if (daysLeft === 1) expiryHtml = `<small>Expires in: 1 day</small><br>`;
                        else if (daysLeft === 0) expiryHtml = `<small>Expires today</small><br>`;
                        else expiryHtml = `<small>Expired</small><br>`;
                    }
                } catch (e) { /* ignore expiry parse errors */ }
                try {
                    if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                        addedAt = data.timestamp.toDate().toLocaleString();
                    } else if (data.timestamp instanceof Date) {
                        addedAt = data.timestamp.toLocaleString();
                    }
                } catch (e) { addedAt = ''; }
                const popupContent = `
                    ${data.note ? `<strong>${data.note}</strong><br>` : ''}
                    ${addedAt ? `<small>Added: ${addedAt}</small><br>` : ''}
                    <small>Added by: ${addedBy}</small><br>
                    ${expiryHtml}
                    <div class="heart-section">${heartButtonHtml}</div>
                `;
                const popup = marker.bindPopup(popupContent);
                if (isHearted) popup.getElement()?.classList.add('hearted');

                marker.on('popupopen', () => {
                    // Declare popupEl in the outer scope so we can attach multiple
                    // handlers and reliably remove them in 'popupclose'.
                    let popupEl = null;
                    try {
                        popupEl = marker.getPopup()?.getElement?.();
                        if (popupEl) {
                            // Standard Leaflet helper
                            if (window.L && window.L.DomEvent && typeof window.L.DomEvent.disableClickPropagation === 'function') {
                                window.L.DomEvent.disableClickPropagation(popupEl);
                            }

                            // Also defensively stop pointer/mousedown/touchstart so popup
                            // doesn't close before click handlers run (some browsers fire
                            // map events on mousedown/focus sequences).
                            const stop = (ev) => { try { ev.stopPropagation(); } catch(e){} };
                            const events = ['pointerdown', 'mousedown', 'touchstart'];
                            popupEl.__reactionStopHandlers = popupEl.__reactionStopHandlers || [];
                            events.forEach((evName) => {
                                popupEl.addEventListener(evName, stop, { passive: false });
                                popupEl.__reactionStopHandlers.push({ evName, fn: stop });
                            });

                            // Cleanup once popup closes (for the pointer handlers)
                            marker.once('popupclose', () => {
                                try {
                                    (popupEl.__reactionStopHandlers || []).forEach(h => popupEl.removeEventListener(h.evName, h.fn));
                                } catch (e) { /* ignore */ }
                                popupEl.__reactionStopHandlers = null;
                            });
                        }
                    } catch (e) {
                        console.warn('Could not disable popup click propagation:', e);
                    }

                    // Unified delegated handler for reaction and report buttons.
                    // Attach to the popup element so clicks are handled before they
                    // reach the map and unintentionally close the popup.
                    const popupClickHandler = async (e) => {
                        try {
                            const heartBtn = e.target.closest && e.target.closest('.heart-button');
                            if (heartBtn) {
                                e.stopPropagation();
                                e.preventDefault();
                                const pid = heartBtn.dataset.pinId;
                                const currentCount = parseInt(document.querySelector(`.heart-count[data-pin-id="${pid}"]`).textContent.match(/\d+/)?.[0] || '0');
                                const isCurrentlyHearted = heartBtn.dataset.hearted === 'true';
                                toggleHeart(pid, currentCount, isCurrentlyHearted);
                                return;
                            }

                            const dislikeBtn = e.target.closest && e.target.closest('.dislike-button');
                            if (dislikeBtn) {
                                e.stopPropagation();
                                e.preventDefault();
                                const pid = dislikeBtn.dataset.pinId;
                                const currentCount = parseInt(document.querySelector(`.dislike-count[data-pin-id="${pid}"]`).textContent.match(/\d+/)?.[0] || '0');
                                const isCurrentlyDisliked = dislikeBtn.dataset.disliked === 'true';
                                toggleDislike(pid, currentCount, isCurrentlyDisliked);
                                return;
                            }

                            const reportBtn = e.target.closest && e.target.closest('.report-button');
                            if (reportBtn) {
                                e.stopPropagation();
                                e.preventDefault();
                                if (data.reported) { showToast('Report submitted.'); return; }
                                if (!isOAuthUser) { if (authModal) authModal.style.display = 'block'; else showToast('Please sign in (Google or GitHub) to report pins.'); return; }
                                const note = window.prompt('Optional: add a short reason for reporting (press Cancel to skip)');
                                try { reportBtn.disabled = true; await reportPin(pinId, data, note || ''); showToast('Pin reported.'); }
                                catch (err) { console.error('Report failed:', err); if (err && err.code && err.code.includes('permission')) { showToast('Reported — pending review (insufficient permissions to remove).'); } else { showToast('Failed to report pin: ' + (err.message || err)); } }
                                finally { reportBtn.disabled = false; }
                                return;
                            }
                        } catch (err) {
                            console.error('Popup click handler error:', err);
                        }
                    };

                    // Ensure we attach once per popup and remove on close
                    if (popupEl) {
                        popupEl.addEventListener('click', popupClickHandler);
                        marker.once('popupclose', () => {
                            try { popupEl.removeEventListener('click', popupClickHandler); } catch (e) { /* ignore */ }
                        });
                    }
                });
            });

            // Render reported docs (show them identical to normal pins)
            window._reportedCache.forEach(({ reportId, data }) => {
                // When viewing public (no active map), skip reported pins that belong to a private map
                if (!activeMapId && data.mapId) {
                    return; // skip private map reported pins when in public view
                }
                
                const marker = window.L.marker([data.lat, data.lng], { icon: getPinIcon(data.color || '#008080') }).addTo(window.markerLayer);
                // For reported docs we render reaction buttons but disable them to avoid
                // attempting writes to /pins/{reportId}/... which would be incorrect and
                // cause permission errors. Reactions on reported items are read-only here.
                const heartButtonHtml = `
                    <button class="heart-button disabled-reaction" data-pin-id="${reportId}" data-hearted="false" disabled aria-disabled="true" title="Reactions disabled on reported pins">♡</button>
                    <span class="heart-count" data-pin-id="${reportId}">(0)</span>
                    <button class="dislike-button disabled-reaction" data-pin-id="${reportId}" data-disliked="false" aria-pressed="false" disabled aria-disabled="true" title="Reactions disabled on reported pins">👎</button>
                    <span class="dislike-count" data-pin-id="${reportId}">(0)</span>
                    <button class="report-button" data-pin-id="${reportId}">Report</button>
                `;
                const addedBy = data.createdByFirstName || 'Anonymous';
                let addedAt = '';
                // Compute expiry display for reported pins as well
                let expiryHtmlReported = '';
                try {
                    if (data && data.expiresAt) {
                        const exp = (typeof data.expiresAt.toDate === 'function') ? data.expiresAt.toDate() : new Date(data.expiresAt);
                        const now = new Date();
                        const msPerDay = 24 * 60 * 60 * 1000;
                        const daysLeft = Math.ceil((exp - now) / msPerDay);
                        if (daysLeft > 1) expiryHtmlReported = `<small>Expires in: ${daysLeft} days</small><br>`;
                        else if (daysLeft === 1) expiryHtmlReported = `<small>Expires in: 1 day</small><br>`;
                        else if (daysLeft === 0) expiryHtmlReported = `<small>Expires today</small><br>`;
                        else expiryHtmlReported = `<small>Expired</small><br>`;
                    }
                } catch (e) { /* ignore */ }
                try {
                    if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                        addedAt = data.timestamp.toDate().toLocaleString();
                    } else if (data.timestamp instanceof Date) {
                        addedAt = data.timestamp.toLocaleString();
                    }
                } catch (e) { addedAt = ''; }
                const popupContent = `
                    ${data.note ? `<strong>${data.note}</strong><br>` : ''}
                    ${addedAt ? `<small>Added: ${addedAt}</small><br>` : ''}
                    <small>Added by: ${addedBy}</small><br>
                    ${expiryHtmlReported}
                    <div class="heart-section">${heartButtonHtml}</div>
                `;
                marker.bindPopup(popupContent);

                marker.on('popupopen', () => {
                    try {
                        const popupEl = marker.getPopup()?.getElement?.();
                        if (popupEl) {
                            if (window.L && window.L.DomEvent && typeof window.L.DomEvent.disableClickPropagation === 'function') {
                                window.L.DomEvent.disableClickPropagation(popupEl);
                            }
                            const stop = (ev) => { try { ev.stopPropagation(); } catch(e){} };
                            const events = ['pointerdown', 'mousedown', 'touchstart'];
                            popupEl.__reactionStopHandlers = popupEl.__reactionStopHandlers || [];
                            events.forEach((evName) => {
                                popupEl.addEventListener(evName, stop, { passive: false });
                                popupEl.__reactionStopHandlers.push({ evName, fn: stop });
                            });
                            marker.once('popupclose', () => {
                                try {
                                    (popupEl.__reactionStopHandlers || []).forEach(h => popupEl.removeEventListener(h.evName, h.fn));
                                } catch (e) { /* ignore */ }
                                popupEl.__reactionStopHandlers = null;
                            });
                        }
                    } catch (e) {
                        console.warn('Could not disable popup click propagation for reported item:', e);
                    }
                    const reportButton = document.querySelector(`.report-button[data-pin-id="${reportId}"]`);
                    if (reportButton) {
                        // Reported doc: clicking report should appear successful but do nothing
                        reportButton.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); showToast('Report submitted.'); });
                    }
                    // Reactions are disabled for reported items to avoid permission errors.
                });
            });
        }

        // Listen for regular pins (filter by active map if set)
        let pinsQuery = null;
        try {
            if (activeMapId) {
                // Private map: show only pins with matching mapId
                pinsQuery = query(collection(db, 'pins'), where('mapId', '==', activeMapId), orderBy('timestamp', 'desc'));
            } else {
                // Public (no active map): show all pins (will filter client-side to exclude private maps)
                // Note: we query all pins because existing pins may not have a mapId field, and Firestore doesn't support OR in where()
                pinsQuery = query(collection(db, 'pins'), orderBy('timestamp', 'desc'));
            }
        } catch (e) {
            console.warn('Could not construct pins query, falling back to unfiltered:', e);
            pinsQuery = query(collection(db, 'pins'), orderBy('timestamp', 'desc'));
        }

    pinsUnsubscribe = onSnapshot(pinsQuery, async (snapshot) => {
            const promises = [];
            snapshot.forEach((docSnapshot) => {
                    const pinId = docSnapshot.id;
                    const data = docSnapshot.data();
                    // Skip expired pins (if expiresAt exists and is in the past)
                    try {
                        let expires = null;
                        if (data && data.expiresAt) {
                            if (typeof data.expiresAt.toDate === 'function') expires = data.expiresAt.toDate();
                            else expires = new Date(data.expiresAt);
                        }
                        if (expires && expires <= new Date()) {
                            // don't include this pin
                            return;
                        }
                    } catch (e) {
                        // ignore parse errors and continue
                    }

                    // Use cached counts from the pin document (much faster than fetching subcollections)
                    // Falls back to 0 if not cached yet
                    const heartCount = data.heartCount || 0;
                    const dislikeCount = data.dislikeCount || 0;
                    
                    // Determine if current user has reacted (only if signed in and have a userId)
                    // For now, use a simpler approach: check cached boolean or fetch lazily later
                    const isHearted = data.userHearts?.includes(currentUserId) || false;
                    const isDisliked = data.userDislikes?.includes(currentUserId) || false;

                    promises.push(
                        Promise.resolve({
                            pinId,
                            data,
                            heartCount,
                            isHearted,
                            dislikeCount,
                            isDisliked
                        })
                    );
            });

            try {
                const pinInfos = await Promise.all(promises);
                window._pinsCache = pinInfos;
                renderAllMarkers();
            } catch (error) {
                console.error('Error loading pins:', error);
                showToast('Failed to load pins: ' + error.message);
            }
        }, (error) => {
            console.error('Snapshot error:', error);
            // If Firestore requires a composite index, the error message contains
            // a console-link the user can click to create it. Extract and surface it.
            try {
                const msg = (error && error.message) ? error.message : String(error);
                const urlMatch = msg.match(/https?:\/\/[^\s)]+/);
                if (msg.includes('requires an index') && urlMatch) {
                    console.warn('Firestore index required for pins query. Create it here:', urlMatch[0]);
                    showToast('Pins query requires a Firestore index. See console for a direct link to create it.');
                    // Fallback: re-run the query without orderBy so results still load (less stable ordering)
                    try {
                        const fallbackQuery = activeMapId ? query(collection(db, 'pins'), where('mapId', '==', activeMapId)) : query(collection(db, 'pins'));
                        if (pinsUnsubscribe) { pinsUnsubscribe(); }
                        pinsUnsubscribe = onSnapshot(fallbackQuery, async (snapshot) => {
                            const promises = [];
                            snapshot.forEach((docSnapshot) => {
                                const pinId = docSnapshot.id;
                                const data = docSnapshot.data();
                                // Skip expired pins (if expiresAt exists and is in the past)
                                try {
                                    let expires = null;
                                    if (data && data.expiresAt) {
                                        if (typeof data.expiresAt.toDate === 'function') expires = data.expiresAt.toDate();
                                        else expires = new Date(data.expiresAt);
                                    }
                                    if (expires && expires <= new Date()) {
                                        // don't include this pin
                                        return;
                                    }
                                } catch (e) { /* ignore */ }
                                const heartsPromise = getDocs(collection(db, 'pins', pinId, 'hearts'))
                                .then((heartsSnapshot) => ({
                                    heartCount: heartsSnapshot.size,
                                    isHearted: heartsSnapshot.docs.some(d => d.id === currentUserId)
                                }))
                                .catch((error) => { console.error('Error fetching hearts for pin', pinId, ':', error); return { heartCount: 0, isHearted: false }; });
                                const dislikesPromise = getDocs(collection(db, 'pins', pinId, 'dislikes'))
                                .then((dislikesSnapshot) => ({
                                    dislikeCount: dislikesSnapshot.size,
                                    isDisliked: dislikesSnapshot.docs.some(d => d.id === currentUserId)
                                }))
                                .catch((error) => { console.error('Error fetching dislikes for pin', pinId, ':', error); return { dislikeCount: 0, isDisliked: false }; });
                                promises.push(Promise.all([heartsPromise, dislikesPromise]).then(([h, d]) => ({ pinId, data, heartCount: h.heartCount, isHearted: h.isHearted, dislikeCount: d.dislikeCount, isDisliked: d.isDisliked })));
                            });
                            try { const pinInfos = await Promise.all(promises); window._pinsCache = pinInfos; renderAllMarkers(); } catch (err2) { console.error('Error loading pins (fallback):', err2); }
                        }, (err2) => { console.error('Fallback pins snapshot error:', err2); showToast('Failed to load pins: ' + (err2 && err2.message ? err2.message : err2)); });
                    } catch (fbErr) { console.error('Failed to attach fallback pins listener:', fbErr); }
                    return;
                }
            } catch (e) { /* parsing errors ignored */ }
            showToast('Failed to load pins: ' + (error && error.message ? error.message : String(error)));
        });

        // Listen for reported pins and update cache (respect active map if set)
        let reportedQuery = null;
        try {
            if (activeMapId) reportedQuery = query(collection(db, 'reported'), where('mapId', '==', activeMapId), orderBy('reportedAt', 'desc'));
            else reportedQuery = query(collection(db, 'reported'), orderBy('reportedAt', 'desc'));
        } catch (e) { reportedQuery = query(collection(db, 'reported'), orderBy('reportedAt', 'desc')); }

        reportedUnsubscribe = onSnapshot(reportedQuery, async (snapshot) => {
            const reports = [];
            snapshot.forEach((docSnapshot) => {
                    const data = docSnapshot.data();
                    // Skip expired reported docs
                    try {
                        let expires = null;
                        if (data && data.expiresAt) {
                            if (typeof data.expiresAt.toDate === 'function') expires = data.expiresAt.toDate();
                            else expires = new Date(data.expiresAt);
                        }
                        if (expires && expires <= new Date()) {
                            return; // skip
                        }
                    } catch (e) {
                        // ignore and include the report
                    }
                    reports.push({ reportId: docSnapshot.id, data });
                });
            window._reportedCache = reports;
            renderAllMarkers();
        }, (error) => {
            console.error('Reported snapshot error:', error);
            try {
                const msg = (error && error.message) ? error.message : String(error);
                const urlMatch = msg.match(/https?:\/\/[^\s)]+/);
                if (msg.includes('requires an index') && urlMatch) {
                    console.warn('Firestore index required for reported query. Create it here:', urlMatch[0]);
                    showToast('Reported query requires a Firestore index. See console for a direct link to create it.');
                    // Fallback: re-run the query without orderBy so results still load
                    try {
                        const fallbackReportedQuery = activeMapId ? query(collection(db, 'reported'), where('mapId', '==', activeMapId)) : query(collection(db, 'reported'));
                        if (reportedUnsubscribe) { reportedUnsubscribe(); }
                        reportedUnsubscribe = onSnapshot(fallbackReportedQuery, async (snapshot) => {
                            const reports = [];
                            snapshot.forEach((docSnapshot) => {
                                const data = docSnapshot.data();
                                try {
                                    let expires = null;
                                    if (data && data.expiresAt) {
                                        if (typeof data.expiresAt.toDate === 'function') expires = data.expiresAt.toDate();
                                        else expires = new Date(data.expiresAt);
                                    }
                                    if (expires && expires <= new Date()) return;
                                } catch (e) {}
                                reports.push({ reportId: docSnapshot.id, data });
                            });
                            window._reportedCache = reports;
                            renderAllMarkers();
                        }, (err2) => { console.error('Fallback reported snapshot error:', err2); });
                    } catch (fbErr) { console.error('Failed to attach fallback reported listener:', fbErr); }
                    return;
                }
            } catch (e) {}
        });

        // Listen for changes to any dislike documents across the database so counts
        // update in near real-time without requiring a full page refresh.
        // We use collectionGroup('dislikes') to watch all dislikes under pins/{pinId}/dislikes.
        try {
            dislikesUnsubscribe = onSnapshot(collectionGroup(db, 'dislikes'), (snap) => {
                // Build a map of pinId => { count, isDislikedForCurrentUser }
                const counts = {}; // pinId -> { count, isDisliked }
                snap.forEach((d) => {
                    // parent of the dislike doc is the dislikes collection; its parent is the pin doc
                    const parent = d.ref.parent; // dislikes collection
                    const pinRef = parent.parent; // pins/{pinId}
                    if (!pinRef) return;
                    const pinId = pinRef.id;
                    if (!counts[pinId]) counts[pinId] = { count: 0, isDisliked: false };
                    counts[pinId].count += 1;
                    if (d.id === currentUserId) counts[pinId].isDisliked = true;
                });

                // Merge counts into the pins cache
                if (Array.isArray(window._pinsCache)) {
                    window._pinsCache = window._pinsCache.map((p) => {
                        const c = counts[p.pinId];
                        if (c) {
                            return { ...p, dislikeCount: c.count, isDisliked: c.isDisliked };
                        }
                        // no dislikes for this pin
                        return { ...p, dislikeCount: 0, isDisliked: false };
                    });
                }
                renderAllMarkers();
            }, (err) => {
                console.error('Dislikes collectionGroup snapshot error:', err);
                // If this is a permissions error, fall back to polling per-pin dislikes
                if (err && err.code && err.code.includes('permission')) {
                    showToast('Real-time dislikes unavailable due to Firestore permissions — falling back to periodic refresh.');
                    startDislikesPolling();
                }
            });
        } catch (err) {
            console.warn('Could not attach dislikes collectionGroup listener:', err);
            // Fall back to polling if collectionGroup attachment fails synchronously
            startDislikesPolling();
        }

        // Polling fallback state
        function startDislikesPolling() {
            if (dislikesPollHandle) return; // already polling
            // immediate fetch once
            fetchAllDislikeCountsForPins().catch(e => console.warn('Initial dislike fetch failed:', e));
            dislikesPollHandle = setInterval(() => {
                fetchAllDislikeCountsForPins().catch(e => console.warn('Periodic dislike fetch failed:', e));
            }, 15000);
        }

        async function fetchAllDislikeCountsForPins() {
            if (!Array.isArray(window._pinsCache) || window._pinsCache.length === 0) return;
            const promises = window._pinsCache.map(async (p) => {
                try {
                    const snap = await getDocs(collection(db, 'pins', p.pinId, 'dislikes'));
                    const count = snap.size;
                    const isDisliked = snap.docs.some(d => d.id === currentUserId);
                    return { pinId: p.pinId, count, isDisliked };
                } catch (err) {
                    console.warn('Error fetching dislikes for pin', p.pinId, err);
                    return { pinId: p.pinId, count: p.dislikeCount || 0, isDisliked: p.isDisliked || false };
                }
            });
            const results = await Promise.all(promises);
            const map = {};
            results.forEach(r => { map[r.pinId] = r; });
            window._pinsCache = window._pinsCache.map((p) => {
                const r = map[p.pinId];
                if (r) return { ...p, dislikeCount: r.count, isDisliked: r.isDisliked };
                return { ...p, dislikeCount: 0, isDisliked: false };
            });
            renderAllMarkers();
        }
}

// Close modals on outside click
window.onclick = (event) => {
    if (event.target === pinModal) {
        pinModal.style.display = 'none';
    }
    if (event.target === howToUseModal) {
        howToUseModal.style.display = 'none';
    }
    if (event.target === aboutModal) {
        aboutModal.style.display = 'none';
    }
};
