(function () {
    'use strict';

    const uploadFile = document.getElementById('uploadFile');
    const uploadTagOptions = document.getElementById('uploadTagOptions');
    const uploadNewTags = document.getElementById('uploadNewTags');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadStatus = document.getElementById('uploadStatus');

    // If the session cookie has expired, the API routes' authenticateToken
    // middleware redirects to the (HTML) login page rather than returning
    // JSON - send the whole page there instead of trying to parse a login
    // page as JSON. Matches the same pattern used by manage.js.
    async function fetchJson(url, options) {
        const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));

        const contentType = response.headers.get('content-type') || '';
        const isNoContent = response.status === 204;

        if (response.redirected || (!isNoContent && !contentType.includes('application/json'))) {
            window.location.href = `/login?next=${encodeURIComponent('/manage/upload')}`;
            return null;
        }

        return response;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function loadTagOptions() {
        const response = await fetchJson('/manage/api/tags');
        if (!response) return;

        const data = await response.json();
        uploadTagOptions.innerHTML = data.tags.length === 0
            ? '<span class="text-muted">No tags yet - add one below.</span>'
            : data.tags.map(tag => `
                <div class="form-check form-check-inline">
                    <input class="form-check-input" type="checkbox" value="${escapeHtml(tag)}" id="uploadTag-${escapeHtml(tag)}">
                    <label class="form-check-label" for="uploadTag-${escapeHtml(tag)}">${escapeHtml(tag)}</label>
                </div>
            `).join('');
    }

    function collectUploadTags() {
        const checked = Array.from(uploadTagOptions.querySelectorAll('input[type=checkbox]:checked')).map(input => input.value);
        const added = uploadNewTags.value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        return [...new Set([...checked, ...added])].join(',');
    }

    // Goes straight to POST /pictures (the same endpoint the camera itself
    // uploads through) rather than a /manage/api route - it already does
    // everything needed (auth, role check, file validation, saving,
    // registering tags), and a "camera"-role session (required for every
    // /manage route, including this page) already satisfies its own role
    // check.
    async function uploadNewPicture() {
        const file = uploadFile.files[0];
        if (!file) {
            uploadStatus.textContent = 'Choose an image first.';
            return;
        }

        const formData = new FormData();
        formData.append('image', file);
        formData.append('tags', collectUploadTags());

        uploadBtn.disabled = true;
        uploadStatus.textContent = 'Uploading...';

        try {
            const response = await fetchJson('/pictures', { method: 'POST', body: formData });
            if (!response) return;

            const data = await response.json();
            if (!response.ok) {
                uploadStatus.textContent = data.error || 'Upload failed.';
                return;
            }

            // Cleared and left on this page (rather than redirecting back to
            // the gallery) so uploading several pictures in a row doesn't
            // mean re-navigating every time - the link below covers "I'm done".
            uploadStatus.innerHTML = '';
            uploadStatus.append(`Uploaded as "${data.phrase}". `);
            const backLink = document.createElement('a');
            backLink.href = '/manage';
            backLink.textContent = 'Back to gallery';
            uploadStatus.append(backLink);

            uploadFile.value = '';
            uploadNewTags.value = '';
            await loadTagOptions();
        } finally {
            uploadBtn.disabled = false;
        }
    }

    uploadBtn.addEventListener('click', uploadNewPicture);

    loadTagOptions();
})();
