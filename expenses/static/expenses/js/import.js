(function () {
  'use strict';

  var input = document.getElementById('csv_file');
  var fileName = document.getElementById('csv_file_name');

  if (!input || !fileName) return;

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    fileName.textContent = file ? file.name : 'No file selected';
  });
})();