// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, getDocs, deleteDoc, onSnapshot, orderBy, setDoc } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js';

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
let authModal = null; // modal prompting sign-in
let pendingLatLng = null; // store attempted lat/lng when user is prompted to sign in
let selectedPinColor = '#008080'; // default pin color

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // Keep UI in sync with auth state (handles Google sign-in and sign-out)
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUserId = user.uid;
            // Save first name if available
            currentUserFirstName = user.displayName ? user.displayName.split(' ')[0] : null;
            // Determine whether the signed-in user used Google provider
            isGoogleUser = user.providerData && user.providerData.some(p => p.providerId === 'google.com');
        } else {
            currentUserId = null;
            currentUserFirstName = null;
            isGoogleUser = false;
        }
        updateAuthUI();
        // If the user just signed in via Google and they had a pending location, open pin modal
        if (isGoogleUser && pendingLatLng) {
            selectedLatLng = pendingLatLng;
            pendingLatLng = null;
            // ensure default color is selected in UI
            selectedPinColor = selectedPinColor || '#008080';
            updatePaletteSelectionUI();
            pinModal.style.display = 'block';
            // focus note input for convenience
            setTimeout(() => document.getElementById('note-input')?.focus(), 100);
        }
    });
    await getUserLocation();
    initMap();
    initModals();
    initSearch();
    loadPins();
});

// Update auth button UI text
function updateAuthUI() {
    const authButton = document.getElementById('auth-button');
    if (!authButton) return;
    const user = auth.currentUser;
    if (user && user.providerData && user.providerData.some(p => p.providerId === 'google.com')) {
        const namePart = currentUserFirstName ? ` (${currentUserFirstName})` : '';
        authButton.textContent = `Sign out${namePart}`;
    } else {
        authButton.textContent = 'Sign in with Google';
    }
}

// Called when user clicks the auth button
async function handleAuthButtonClick() {
    const user = auth.currentUser;
    // If already signed in with Google, sign out
    if (user && user.providerData && user.providerData.some(p => p.providerId === 'google.com')) {
        try {
            await signOut(auth);
            showToast('Signed out');
        } catch (err) {
            console.error('Sign out error:', err);
            showToast('Sign out failed: ' + err.message);
        }
        return;
    }

    // Otherwise, initiate Google sign-in
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        // result.user contains the signed-in user; onAuthStateChanged will update UI
        showToast(`Signed in as ${result.user.displayName || 'Google user'}`);
    } catch (err) {
        console.error('Google sign-in error:', err);
        showToast('Google sign-in failed: ' + (err.message || err));
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
        document.getElementById('location-status').textContent = `Centered on your current location.`;
    } catch (geoError) {
        console.warn('Browser geolocation failed or denied:', geoError);

        // fallback to IP lookup
        try {
            const response = await fetch('https://ipapi.co/json/');
            const data = await response.json();
            if (data && data.latitude && data.longitude) {
                currentLat = data.latitude;
                currentLng = data.longitude;
                document.getElementById('location-status').textContent = `Centered on your approximate location.`;
            } else {
                throw new Error('IP geolocation returned invalid data');
            }
        } catch (ipError) {
            console.error('IP geolocation error:', ipError);
            document.getElementById('location-status').textContent = 'Using default location (San Francisco).';
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
    map = window.L.map('map').setView([currentLat || 37.7749, currentLng || -122.4194], 13);

    // Add OpenStreetMap tile layer
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Click to add pin and remove search marker
    map.on('click', (e) => {
        if (!isGoogleUser) {
            // Prompt user to sign in and remember the attempted location
            pendingLatLng = e.latlng;
            if (authModal) authModal.style.display = 'block';
            else showToast('Please sign in with Google to add pins.');
            return;
        }
        selectedLatLng = e.latlng;
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
}

function updatePaletteSelectionUI() {
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(s => {
        if (s.dataset.color === selectedPinColor) s.classList.add('selected');
        else s.classList.remove('selected');
    });
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
                        document.getElementById('location-status').textContent = `Showing: ${item.display_name}`;
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
                        // Add event listener for the button
                        setTimeout(() => { // Delay to ensure button is in DOM
                            const placeButton = document.querySelector('.place-pin-button');
                            if (placeButton) {
                                        placeButton.addEventListener('click', () => {
                                            // If not signed in with Google, prompt and store pending lat/lng
                                            if (!isGoogleUser) {
                                                pendingLatLng = { lat, lng: lon };
                                                if (authModal) authModal.style.display = 'block';
                                                else showToast('Please sign in with Google to add pins.');
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
                        }, 100);
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
            document.getElementById('location-status').textContent = `Showing: ${display_name}`;
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
            // Add event listener for the button
            setTimeout(() => { // Delay to ensure button is in DOM
                const placeButton = document.querySelector('.place-pin-button');
                if (placeButton) {
                    placeButton.addEventListener('click', () => {
                        if (!isGoogleUser) {
                            pendingLatLng = { lat: parsedLat, lng: parsedLon };
                            if (authModal) authModal.style.display = 'block';
                            else showToast('Please sign in with Google to add pins.');
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
            }, 100);
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
    if (!isGoogleUser) {
        showToast('Please sign in with Google to like pins.');
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

        // Update the open popup's heart button and count
        const heartButton = document.querySelector(`[data-pin-id="${pinId}"]`);
        if (heartButton) {
            heartButton.textContent = newHeartedState ? '♥' : '♡';
            heartButton.dataset.hearted = newHeartedState;
            const heartCountElement = heartButton.nextElementSibling;
            if (heartCountElement && heartCountElement.classList.contains('heart-count')) {
                heartCountElement.textContent = `(${newHeartCount})`;
            }
            const popupElement = heartButton.closest('.leaflet-popup-content');
            if (popupElement) {
                const heartSection = popupElement.querySelector('.heart-section');
                if (heartSection) {
                    if (newHeartedState) {
                        heartSection.classList.add('hearted');
                    } else {
                        heartSection.classList.remove('hearted');
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error toggling heart:', error, 'Pin ID:', pinId, 'User ID:', currentUserId);
        showToast('Failed to toggle heart: ' + error.message);
    }
}

// Save pin to Firestore
async function savePin() {
    if (!selectedLatLng) return;
    if (!isGoogleUser) {
        showToast('Please sign in with Google to add pins.');
        return;
    }

    const note = document.getElementById('note-input').value.trim();
    if (note.length > 100) return; // Enforced by maxlength, but double-check

    try {
        const pinRef = await addDoc(collection(db, 'pins'), {
            lat: selectedLatLng.lat,
            lng: selectedLatLng.lng,
            note: note || '',
            timestamp: new Date(),
            createdById: currentUserId || null,
            createdByFirstName: currentUserFirstName || null,
            color: selectedPinColor || '#008080'
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
    onSnapshot(collection(db, 'pins'), orderBy('timestamp', 'desc'), async (snapshot) => {
        // Clear existing markers (use a layer group for efficiency)
        if (window.markerLayer) {
            window.markerLayer.clearLayers();
        } else {
            window.markerLayer = window.L.layerGroup().addTo(map);
        }

        const promises = [];
        snapshot.forEach((docSnapshot) => {
            const pinId = docSnapshot.id;
            const data = docSnapshot.data();
            promises.push(
                getDocs(collection(db, 'pins', pinId, 'hearts')).then((heartsSnapshot) => {
                    const heartCount = heartsSnapshot.size;
                    const isHearted = heartsSnapshot.docs.some(d => d.id === currentUserId);
                    return { pinId, data, heartCount, isHearted };
                }).catch((error) => {
                    console.error('Error fetching hearts for pin', pinId, ':', error);
                    return { pinId, data, heartCount: 0, isHearted: false };
                })
            );
        });

        try {
            const pinInfos = await Promise.all(promises);

            pinInfos.forEach(({ pinId, data, heartCount, isHearted }) => {
                const marker = window.L.marker([data.lat, data.lng], { icon: getPinIcon(data.color || '#008080') }).addTo(window.markerLayer);
                const heartButtonHtml = `
                    <button class="heart-button" data-pin-id="${pinId}" data-hearted="${isHearted}">
                        ${isHearted ? '♥' : '♡'}
                    </button>
                    <span class="heart-count">(${heartCount})</span>
                `;
                const addedBy = data.createdByFirstName || 'Anonymous';
                // timestamp may be a Date or Firestore Timestamp; handle both
                let addedAt = '';
                try {
                    if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                        addedAt = data.timestamp.toDate().toLocaleString();
                    } else if (data.timestamp instanceof Date) {
                        addedAt = data.timestamp.toLocaleString();
                    } else {
                        addedAt = '';
                    }
                } catch (e) {
                    addedAt = '';
                }

                const popupContent = `
                    ${data.note ? `<strong>${data.note}</strong><br>` : ''}
                    ${addedAt ? `<small>Added: ${addedAt}</small><br>` : ''}
                    <small>Added by: ${addedBy}</small><br>
                    <div class="heart-section">${heartButtonHtml}</div>
                `;
                const popup = marker.bindPopup(popupContent);
                        if (isHearted) {
                            popup.getElement()?.classList.add('hearted'); // Apply hearted styles
                        }

                        // Delegate event listener for heart button
                        marker.on('popupopen', () => {
                            const heartButton = document.querySelector(`[data-pin-id="${pinId}"]`);
                            if (heartButton) {
                                heartButton.addEventListener('click', () => {
                                    const currentCount = parseInt(heartButton.nextElementSibling.textContent.match(/\d+/)?.[0] || '0');
                                    const isCurrentlyHearted = heartButton.dataset.hearted === 'true';
                                    toggleHeart(pinId, currentCount, isCurrentlyHearted);
                                });
                            }
                        });
            });
        } catch (error) {
            console.error('Error loading pins:', error);
            showToast('Failed to load pins: ' + error.message);
        }
    }, (error) => {
        console.error('Snapshot error:', error);
        showToast('Failed to load pins: ' + error.message);
    });
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
