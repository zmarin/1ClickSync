document.addEventListener('DOMContentLoaded', function() {
    var syncButton = document.getElementById('syncButton');
    if (syncButton) {
        syncButton.addEventListener('click', syncDataToTodoist);
    }
});

function syncDataToTodoist() {
    const statusDiv = document.getElementById('statusDiv'); // Ensure this element exists in your HTML
    fetch('{{ url_for("complete_sync") }}', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken  // Use the global variable
        },
        body: JSON.stringify({ user_id: userId })  // Use the global variable
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        statusDiv.innerHTML = `<div class="alert alert-success">${data.message}</div>`;
    })
    .catch(error => {
        console.error('Sync failed:', error);
        statusDiv.innerHTML = `<div class="alert alert-danger">Sync failed: ${error.message}</div>`;
    });
}
