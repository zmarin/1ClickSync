// Global CSRF Token
const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

document.addEventListener("DOMContentLoaded", function() {
    if (!isPortalSelected) {
        fetchPortals();
    }
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById("save_portal_selection").addEventListener("click", function() {
        const portalId = document.getElementById("zoho_portal_select").value;
        if (!portalId) {
            alert('Please select a portal before saving.');
            return;
        }
        savePortalSelection(portalId);
    });
}

function fetchWithCsrf(url, options = {}) {
    const defaultHeaders = {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json'
    };

    // Merge headers
    options.headers = { ...defaultHeaders, ...options.headers };

    return fetch(url, options)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
            return response.json();
        });
}

function fetchPortals() {
    fetchWithCsrf('/get_portals')
        .then(portals => populatePortalsDropdown(portals))
        .catch(error => {
            console.error('Failed to fetch portals:', error);
            alert('Failed to fetch portals. Please try again later.');
        });
}

function populatePortalsDropdown(portals) {
    const select = document.getElementById('zoho_portal_select');
    select.innerHTML = '';  // Clear existing options
    if (portals.length > 0) {
        portals.forEach(portal => select.add(new Option(portal.name, portal.id)));
    } else {
        select.add(new Option('No available portals', ''));
        select.disabled = true;
    }
}

function savePortalSelection(portalId) {
    fetchWithCsrf('/save_portal_selection', {
        method: 'POST',
        body: JSON.stringify({ portal_id: portalId })
    })
    .then(data => {
        if (data.status === 'success') {
            alert('Portal selection saved successfully.');
        } else {
            throw new Error(data.message);
        }
    })
    .catch(error => {
        console.error('An error occurred while saving the portal selection:', error);
        alert(`An error occurred while saving the portal selection: ${error.message || error}`);
    });
}
