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
    // check. That endpoint only ever takes one file per request (that's all
    // the camera ever sends), so multiple selected files are uploaded one
    // request at a time rather than in a single multi-file request.
    async function uploadOnePicture(file, tags) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('tags', tags);

        const response = await fetchJson('/pictures', { method: 'POST', body: formData });
        if (!response) return null;

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Upload failed.');
        }

        return data;
    }

    async function uploadNewPicture() {
        const files = Array.from(uploadFile.files);
        if (files.length === 0) {
            uploadStatus.textContent = 'Choose one or more images first.';
            return;
        }

        const tags = collectUploadTags();
        const phrases = [];

        uploadBtn.disabled = true;

        try {
            for (let i = 0; i < files.length; i++) {
                uploadStatus.textContent = files.length === 1
                    ? 'Uploading...'
                    : `Uploading ${i + 1} of ${files.length}...`;

                const data = await uploadOnePicture(files[i], tags);
                if (!data) return; // fetchJson already redirected to login
                phrases.push(data.phrase);
            }

            // Cleared and left on this page (rather than redirecting back to
            // the gallery) so uploading several pictures in a row doesn't
            // mean re-navigating every time - the link below covers "I'm done".
            uploadStatus.innerHTML = '';
            uploadStatus.append(phrases.length === 1
                ? `Uploaded as "${phrases[0]}". `
                : `Uploaded ${phrases.length} pictures: ${phrases.join(', ')}. `);
            const backLink = document.createElement('a');
            backLink.href = '/manage';
            backLink.textContent = 'Back to gallery';
            uploadStatus.append(backLink);

            uploadFile.value = '';
            uploadNewTags.value = '';
            await loadTagOptions();
        } catch (err) {
            uploadStatus.textContent = phrases.length > 0
                ? `${err.message} (${phrases.length} of ${files.length} uploaded before this failure.)`
                : err.message;
        } finally {
            uploadBtn.disabled = false;
        }
    }

    uploadBtn.addEventListener('click', uploadNewPicture);

    loadTagOptions();
})();
