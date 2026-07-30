(function () {
    'use strict';

    const tagList = document.getElementById('tagList');
    const startBtn = document.getElementById('startBtn');

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function loadTags() {
        try {
            const response = await fetch('/random/tags');
            const data = await response.json();

            if (data.tags.length === 0) {
                tagList.textContent = 'No tags yet - the slideshow will show everything.';
                return;
            }

            tagList.innerHTML = data.tags.map(tag => `
                <div class="form-check form-check-inline">
                    <input class="form-check-input" type="checkbox" value="${escapeHtml(tag)}" id="tag-${escapeHtml(tag)}">
                    <label class="form-check-label" for="tag-${escapeHtml(tag)}">${escapeHtml(tag)}</label>
                </div>
            `).join('');
        } catch (err) {
            tagList.textContent = 'Could not load tags - the slideshow will show everything.';
        }
    }

    function startSlideshow() {
        const checked = Array.from(tagList.querySelectorAll('input[type=checkbox]:checked')).map(input => input.value);
        const query = checked.length > 0 ? `?tags=${encodeURIComponent(checked.join(','))}` : '';
        window.location.href = `/slideshow/view${query}`;
    }

    startBtn.addEventListener('click', startSlideshow);

    loadTags();
})();
