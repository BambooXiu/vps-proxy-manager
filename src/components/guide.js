// ==================== Guide Component ====================

window.App = window.App || {};

(function() {
  function init() {
    // FAQ 展开/收起
    document.querySelectorAll('.faq-question').forEach(question => {
      question.addEventListener('click', () => {
        const item = question.parentElement;
        item.classList.toggle('open');
      });
    });
  }

  window.App.guide = { init };
})();
