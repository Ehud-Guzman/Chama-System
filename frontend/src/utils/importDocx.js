import mammoth from 'mammoth';

// Parse a .docx file and extract HTML content
export async function importDocxFile(file) {
  if (!file) throw new Error('No file provided');

  if (!file.name.toLowerCase().endsWith('.docx')) {
    throw new Error('Please upload a .docx file');
  }

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });

  if (result.messages.length > 0) {
    console.warn('Docx conversion warnings:', result.messages);
  }

  return result.value;
}

// Trigger a file input for the user to select a .docx
export async function promptForDocxImport() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx, application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.onchange = async (e) => {
      try {
        const file = e.target.files?.[0];
        if (!file) return;
        const html = await importDocxFile(file);
        resolve(html);
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
