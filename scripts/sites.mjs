export const sites = [
  // --- Disabled for now (GitHub-hosted runners get 503/504 from these SAP/SF boards) ---
  /*
  {
    company: { id: "biontech", name: "BioNTech", careersUrl: "https://jobs.biontech.com/search/" },
    kind: "sap_html",
    sap: { pageSize: 100, maxStart: 5000 }
  },
  {
    company: { id: "boehringer", name: "Boehringer Ingelheim", careersUrl: "https://jobs.boehringer-ingelheim.com/search/" },
    kind: "sap_html",
    sap: { pageSize: 100, maxStart: 5000 }
  },
  */

  // --- Workday sources (OK on GitHub-hosted runners) ---

  // Existing
  {
    company: {
      id: "immatics",
      name: "Immatics",
      careersUrl: "https://immatics.wd3.myworkdayjobs.com/Immatics_External"
    },
    kind: "workday",
    workday: { host: "immatics.wd3.myworkdayjobs.com", tenant: "immatics", site: "Immatics_External" }
  },
  {
    company: {
      id: "gsk",
      name: "GSK",
      careersUrl: "https://gsk.wd5.myworkdayjobs.com/GSKCareers"
    },
    kind: "workday",
    workday: { host: "gsk.wd5.myworkdayjobs.com", tenant: "gsk", site: "GSKCareers" }
  },
  {
    company: {
      id: "pfizer",
      name: "Pfizer",
      careersUrl: "https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers"
    },
    kind: "workday",
    workday: { host: "pfizer.wd1.myworkdayjobs.com", tenant: "pfizer", site: "PfizerCareers" }
  },

  // NEW: Johnson & Johnson (Workday tenant/site: jj / JJ)
  {
    company: {
      id: "jnj",
      name: "Johnson & Johnson",
      careersUrl: "https://jj.wd5.myworkdayjobs.com/en-US/JJ"
    },
    kind: "workday",
    workday: { host: "jj.wd5.myworkdayjobs.com", tenant: "jj", site: "JJ" }
  },

  // NEW: Roche (Workday tenant/site: roche / roche-ext)
  {
    company: {
      id: "roche",
      name: "Roche",
      careersUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext"
    },
    kind: "workday",
    workday: { host: "roche.wd3.myworkdayjobs.com", tenant: "roche", site: "roche-ext" }
  },

  // NEW: Novartis (Workday tenant/site: novartis / Novartis_Careers)
  {
    company: {
      id: "novartis",
      name: "Novartis",
      careersUrl: "https://novartis.wd3.myworkdayjobs.com/Novartis_Careers"
    },
    kind: "workday",
    workday: { host: "novartis.wd3.myworkdayjobs.com", tenant: "novartis", site: "Novartis_Careers" }
  },

  // NEW: Sanofi (Workday tenant/site: sanofi / SanofiCareers)
  {
    company: {
      id: "sanofi",
      name: "Sanofi",
      careersUrl: "https://sanofi.wd3.myworkdayjobs.com/en-US/SanofiCareers"
    },
    kind: "workday",
    workday: { host: "sanofi.wd3.myworkdayjobs.com", tenant: "sanofi", site: "SanofiCareers" }
  },

  // NEW: AstraZeneca (Workday tenant/site: astrazeneca / Careers)
  {
    company: {
      id: "astrazeneca",
      name: "AstraZeneca",
      careersUrl: "https://astrazeneca.wd3.myworkdayjobs.com/Careers"
    },
    kind: "workday",
    workday: { host: "astrazeneca.wd3.myworkdayjobs.com", tenant: "astrazeneca", site: "Careers" }
  }

  // NOTE: Bayer is NOT Workday (talent.bayer.com), so it needs a separate adapter.
];
