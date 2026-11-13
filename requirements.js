(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Requirements = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const maxFileSize = 10 * 1024 * 1024;
  const maxTextLength = 200000;
  let mammothPromise;

  function loadMammoth() {
    if (globalThis.mammoth) return Promise.resolve(globalThis.mammoth);
    if (!mammothPromise) {
      mammothPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'assets/vendor/mammoth/mammoth.browser.js';
        script.onload = () => globalThis.mammoth ? resolve(globalThis.mammoth) : reject(new Error('DOCX reader did not load.'));
        script.onerror = () => reject(new Error('DOCX reader could not load. Check the local app files.'));
        document.head.append(script);
      }).catch(error => { mammothPromise = null; throw error; });
    }
    return mammothPromise;
  }

  async function extractDocument(file) {
    if (!file || !/\.(txt|pdf|docx)$/i.test(file.name)) throw new Error('Choose a PDF, DOCX or TXT file.');
    if (file.size > maxFileSize) throw new Error('Choose a file of at most 10 MB.');
    let text;
    try {
      const buffer = await file.arrayBuffer();
      if (/\.txt$/i.test(file.name)) {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } else if (/\.docx$/i.test(file.name)) {
        const mammoth = await loadMammoth();
        text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
      } else {
        const pdfjs = await import('./assets/vendor/pdfjs/pdf.min.js');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
        const task = pdfjs.getDocument({
          data: buffer,
          cMapUrl: new URL('./assets/vendor/pdfjs/cmaps/', document.baseURI).href,
          cMapPacked: true,
          standardFontDataUrl: new URL('./assets/vendor/pdfjs/standard_fonts/', document.baseURI).href
        });
        try {
          const pdf = await task.promise;
          const pages = [];
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            pages.push(content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join(''));
            page.cleanup();
          }
          text = pages.join('\n');
        } finally { await task.destroy(); }
      }
    } catch (error) {
      if (error.name === 'PasswordException') throw new Error('This PDF is password-protected. Choose an unlocked copy.');
      if (error.message && /reader (could not|did not) load/.test(error.message)) throw error;
      throw new Error('Could not read this file. Check its format, encoding and whether it is damaged or locked.');
    }
    text = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw new Error('No readable text found. Scanned PDFs need text recognition before upload.');
    if (text.length > maxTextLength) throw new Error('Document text is too long. Choose a file with at most 200,000 characters.');
    return text;
  }

  function splitRequirements(text) {
    const lines = String(text || '').split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
      .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);
    return lines;
  }

  // These are review prompts, not assumptions about a system's actual behaviour.
  function templateFor(requirement) {
    if (/\b(role\w*|permission\w*|authori[sz]\w*|access|login|log in|sign in)\b/i.test(requirement)) {
      return ['Access', 'Try the action with an allowed user or role', 'Try the action with a user or role without access',
        'The permitted user or role can perform the action described in the requirement.',
        'Access is handled according to the requirement; unauthorized data or actions are not exposed.'];
    }
    if (/\b(field|input|form|validat|mandatory|required|length|format)\w*\b/i.test(requirement)) {
      return ['Input', 'Enter valid input described by the requirement', 'Try missing, invalid or boundary input',
        'Input that meets the stated rules is handled as described.',
        'Missing, invalid and boundary inputs are handled according to the stated rules.'];
    }
    if (/\b(save|create|update|delete|submit|export|import|download|upload)\w*\b/i.test(requirement)) {
      return ['Data', 'Perform the action and check the resulting data', 'Interrupt or retry the action and check the resulting data',
        'The action and resulting data match the requirement.',
        'An interrupted or repeated action is handled according to the requirement without unintended changes.'];
    }
    if (/\b(navigat|page|screen|button|display|show|view)\w*\b/i.test(requirement)) {
      return ['UI', 'Open the screen and check the described action', 'Check an unavailable or unexpected screen state',
        'The screen and action match the requirement.',
        'The unavailable or unexpected state is handled according to the agreed requirements.'];
    }
    return ['General', 'Check the described behaviour', 'Check an exception or alternate path',
      'The observed behaviour matches the requirement.', 'The alternate or failure outcome matches the agreed requirements.'];
  }

  function buildSuite(requirements, context) {
    const scenarios = [], testCases = [];
    requirements.forEach((requirement, index) => {
      const [profile, action] = templateFor(requirement);
      const scenarioId = `TS_${String(index + 1).padStart(3, '0')}`;
      scenarios.push({ id: scenarioId, cat: 'Functional', pri: 'High', desc: requirement });
      testCases.push({
        id: `TC_${String(testCases.length + 1).padStart(3, '0')}`,
        type: 'Functional', pri: 'High',
        scenario: `${profile} workflow: ${requirement}`,
        steps: `1. Prepare the user, starting state and test data specified in the requirement for ${context.module} at ${context.url}.\n2. ${action}:\n${requirement}\n3. Complete the business action and verify the resulting state, data and downstream effects required by this workflow.`,
        expected: `The completed workflow and its resulting state satisfy this requirement:\n${requirement}\nUse only outcomes stated in the approved requirement; confirm unspecified details before execution.`,
        status: 'Not Run'
      });
    });
    if (requirements.length) {
      scenarios.push({
        id: `TS_${String(scenarios.length + 1).padStart(3, '0')}`,
        cat: 'Functional', pri: 'High',
        desc: `End-to-end: complete the ${context.module} business workflow across the supplied requirements. Confirm the proposed document order before execution.`
      });
      const workflow = requirements.map((requirement, index) => `${index + 2}. ${requirement}`).join('\n');
      testCases.push({
        id: `TC_${String(testCases.length + 1).padStart(3, '0')}`,
        type: 'Functional', pri: 'High',
        scenario: `End-to-end: ${context.module} workflow from initial state to final business outcome`,
        steps: `1. Review the proposed requirement order below, confirm which steps belong to the same workflow, and prepare the specified user and data at ${context.url}.\n${workflow}\n${requirements.length + 2}. Verify the final business outcome and required data handoffs${context.impactedAreas ? ` with ${context.impactedAreas}` : ''}.`,
        expected: 'The confirmed end-to-end workflow completes with the final outcome, state transitions and data handoffs defined by the approved requirements. Confirm unspecified order or outcomes before execution.',
        status: 'Not Run'
      });
    }
    return {
      scenarios, testCases,
      checklists: {
        reqMatch: [{ text: 'Review every draft against the approved requirements.', done: false }]
          .concat(context.uiElements ? [{ text: `Review the listed UI fields: ${context.uiElements}.`, done: false }] : []),
        exploratory: [{ text: 'Confirm business prerequisites, test data and the end-to-end workflow order before execution.', done: false }],
        regression: [{ text: context.impactedAreas
          ? `Review these connected modules for regression: ${context.impactedAreas}.`
          : 'Review connected modules for regression impact.', done: false }]
      }
    };
  }
  return { extractDocument, splitRequirements, templateFor, buildSuite };
});
