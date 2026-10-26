window.AppUI = {
    showStatus(message, type = 'loading') {
        const status = document.getElementById('status');
        status.textContent = message;
        status.className = `status ${type}`;
    },

    hideStatus() {
        document.getElementById('status').className = 'status';
    }
};
 