(function () {
    'use strict';

    const galleryGrid = document.getElementById('galleryGrid');
    const galleryStatus = document.getElementById('galleryStatus');
    const pageIndicator = document.getElementById('pageIndicator');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const tagFilter = document.getElementById('tagFilter');

    const viewerOverlay = document.getElementById('viewerOverlay');
    const viewerImage = document.getElementById('viewerImage');
    const viewerPhrase = document.getElementById('viewerPhrase');
    const viewerTags = document.getElementById('viewerTags');
    const viewerAiInstruction = document.getElementById('viewerAiInstruction');
    const viewerOriginalPhrase = document.getElementById('viewerOriginalPhrase');
    const viewerOriginalLink = document.getElementById('viewerOriginalLink');
    const viewerStatus = document.getElementById('viewerStatus');
    const closeViewerBtn = document.getElementById('closeViewerBtn');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    let currentPage = 1;
    let currentTag = '';
    let totalPages = 1;
    let currentPhrase = null;

    // If the session cookie has expired between page loads, the API routes'
    // authenticateToken middleware redirects to the (HTML) login page rather
    // than returning JSON - send the whole page there instead of trying to
    // parse a login page as JSON.
    async function fetchJson(url, options) {
        const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));

        const contentType = response.headers.get('content-type') || '';
        const isNoContent = response.status === 204;

        if (response.redirected || (!isNoContent && !contentType.includes('application/json'))) {
            window.location.href = `/login?next=${encodeURIComponent('/manage')}`;
            return null;
        }

        return response;
    }

    async function loadTags() {
        const response = await fetchJson('/manage/api/tags');
        if (!response) return;

        const data = await response.json();
        tagFilter.innerHTML = '<option value="">All tags</option>' +
            data.tags.map(tag => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('');
    }

    async function loadPage(page) {
        const url = `/manage/api/pictures?page=${page}&tag=${encodeURIComponent(currentTag)}`;
        const response = await fetchJson(url);
        if (!response) return;

        const data = await response.json();
        currentPage = data.page;
        totalPages = data.totalPages;

        renderGrid(data.pictures);

        pageIndicator.textContent = data.totalCount === 0
            ? 'No pictures'
            : `Page ${currentPage} of ${totalPages} (${data.totalCount} pictures)`;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    function renderGrid(pictures) {
        galleryGrid.innerHTML = '';

        for (const picture of pictures) {
            const col = document.createElement('div');
            col.className = 'col';
            col.innerHTML = `
                <div class="card h-100">
                    <img src="/pictures/${encodeURIComponent(picture.filename)}" alt="${escapeHtml(picture.phrase)}" class="gallery-thumb">
                    <div class="card-body">
                        <p class="card-text">${escapeHtml(picture.phrase)}</p>
                        <p class="card-text"><small class="text-muted">${escapeHtml(picture.tags)}</small></p>
                    </div>
                </div>
            `;
            col.querySelector('.gallery-thumb').addEventListener('click', () => openViewer(picture.phrase));
            galleryGrid.appendChild(col);
        }
    }

    async function openViewer(phrase) {
        const response = await fetchJson(`/manage/api/pictures/${encodeURIComponent(phrase)}`);
        if (!response) return;

        const picture = await response.json();
        currentPhrase = picture.phrase;

        viewerImage.src = `/pictures/${encodeURIComponent(picture.filename)}`;
        viewerImage.alt = picture.phrase;
        viewerPhrase.textContent = picture.phrase;
        viewerTags.value = picture.tags;
        viewerAiInstruction.value = picture.aiInstruction;
        viewerOriginalPhrase.value = picture.originalPhrase;
        viewerStatus.textContent = '';
        updateOriginalLink();

        viewerOverlay.classList.remove('d-none');
    }

    function closeViewer() {
        viewerOverlay.classList.add('d-none');
        currentPhrase = null;
    }

    function updateOriginalLink() {
        const phrase = viewerOriginalPhrase.value.trim();
        if (phrase) {
            viewerOriginalLink.href = `/pictures/${encodeURIComponent(phrase)}`;
            viewerOriginalLink.classList.remove('d-none');
        } else {
            viewerOriginalLink.classList.add('d-none');
        }
    }

    async function saveCurrentPicture() {
        if (!currentPhrase) return;

        viewerStatus.textContent = 'Saving...';

        const response = await fetchJson(`/manage/api/pictures/${encodeURIComponent(currentPhrase)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tags: viewerTags.value,
                aiInstruction: viewerAiInstruction.value,
                originalPhrase: viewerOriginalPhrase.value
            })
        });
        if (!response) return;

        if (!response.ok) {
            viewerStatus.textContent = 'Save failed.';
            return;
        }

        viewerStatus.textContent = 'Saved.';
        updateOriginalLink();
        loadTags();
        loadPage(currentPage);
    }

    async function deleteCurrentPicture() {
        if (!currentPhrase) return;
        if (!window.confirm(`Delete picture "${currentPhrase}"? This cannot be undone.`)) return;

        const response = await fetchJson(`/manage/api/pictures/${encodeURIComponent(currentPhrase)}`, {
            method: 'DELETE'
        });
        if (!response) return;

        if (!response.ok) {
            viewerStatus.textContent = 'Delete failed.';
            return;
        }

        closeViewer();
        loadTags();
        loadPage(currentPage);
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) loadPage(currentPage - 1);
    });

    nextPageBtn.addEventListener('click', () => {
        if (currentPage < totalPages) loadPage(currentPage + 1);
    });

    tagFilter.addEventListener('change', () => {
        currentTag = tagFilter.value;
        loadPage(1);
    });

    closeViewerBtn.addEventListener('click', closeViewer);
    saveBtn.addEventListener('click', saveCurrentPicture);
    deleteBtn.addEventListener('click', deleteCurrentPicture);
    viewerOriginalPhrase.addEventListener('input', updateOriginalLink);

    // Left/right paging only applies to the gallery, not while the viewer is
    // open (where arrow keys need to move the text cursor in the inputs) or
    // Escape closes the viewer instead.
    document.addEventListener('keydown', (event) => {
        if (!viewerOverlay.classList.contains('d-none')) {
            if (event.key === 'Escape') closeViewer();
            return;
        }

        if (event.key === 'ArrowLeft' && currentPage > 1) {
            loadPage(currentPage - 1);
        } else if (event.key === 'ArrowRight' && currentPage < totalPages) {
            loadPage(currentPage + 1);
        }
    });

    loadTags();
    loadPage(1);
})();
