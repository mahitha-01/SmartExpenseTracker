(function () {
  'use strict';

  var input = document.getElementById('receipt_file');
  var fileName = document.getElementById('receipt_file_name');

  if (!input || !fileName) return;

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    fileName.textContent = file ? file.name : 'No file selected';
  });
})();
