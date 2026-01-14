// Helper methods for UIController - password strength, loading states, etc.

// Add these methods to UIController.prototype or extend the class

function updatePasswordStrength(password) {
    const strengthDiv = document.getElementById('password-strength');
    
    if (!password) {
        strengthDiv.textContent = '';
        strengthDiv.className = 'password-strength';
        return;
    }
    
    let strength = 0;
    let message = '';
    let className = '';
    
    // Length check
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    
    // Character variety checks
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    
    if (strength < 3) {
        message = '❌ Weak password';
        className = 'password-strength weak';
    } else if (strength < 5) {
        message = '⚠️ Medium password';
        className = 'password-strength medium';
    } else {
        message = '✅ Strong password';
        className = 'password-strength strong';
    }
    
    strengthDiv.textContent = message;
    strengthDiv.className = className;
}

function validatePasswordMatch() {
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-password-confirm').value;
    const confirmInput = document.getElementById('signup-password-confirm');
    
    if (!confirm) {
        confirmInput.style.borderColor = '';
        return;
    }
    
    if (password === confirm) {
        confirmInput.style.borderColor = '#4CAF50';
    } else {
        confirmInput.style.borderColor = '#f44336';
    }
}

function setButtonLoading(button, isLoading) {
    const btnText = button.querySelector('.btn-text');
    const btnSpinner = button.querySelector('.btn-spinner');
    
    if (isLoading) {
        btnText.classList.add('hidden');
        btnSpinner.classList.remove('hidden');
        button.disabled = true;
    } else {
        btnText.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
        button.disabled = false;
    }
}

function showError(elementId, message) {
    const errorDiv = document.getElementById(elementId);
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function showSuccess(elementId, message) {
    const successDiv = document.getElementById(elementId);
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
}

function showEmailVerificationBanner() {
    const banner = document.createElement('div');
    banner.className = 'verification-banner';
    banner.innerHTML = `
        <p>⚠️ Please verify your email to access all features.</p>
        <button id="resend-verification-btn" class="btn btn-small">Resend Email</button>
    `;
    
    const mainMenu = document.getElementById('main-menu');
    const existingBanner = mainMenu.querySelector('.verification-banner');
    if (existingBanner) {
        existingBanner.remove();
    }
    
    mainMenu.insertBefore(banner, mainMenu.firstChild);
    
    document.getElementById('resend-verification-btn').addEventListener('click', async () => {
        const result = await window.authService.resendVerificationEmail();
        if (result.success) {
            alert(result.message);
        } else {
            alert(result.error);
        }
    });
}

// Attach methods to UIController prototype
if (typeof UIController !== 'undefined') {
    UIController.prototype.updatePasswordStrength = updatePasswordStrength;
    UIController.prototype.validatePasswordMatch = validatePasswordMatch;
    UIController.prototype.setButtonLoading = setButtonLoading;
    UIController.prototype.showError = showError;
    UIController.prototype.showSuccess = showSuccess;
    UIController.prototype.showEmailVerificationBanner = showEmailVerificationBanner;
}
