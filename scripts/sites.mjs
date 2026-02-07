export const sites = [
  // SAP / SuccessFactors HTML boards
  {
    company: {
      id: "biontech",
      name: "BioNTech",
      careersUrl: "https://jobs.biontech.com/search/"
    },
    kind: "sap_html",
    sap: { pageSize: 100, maxStart: 5000 }
  },
  {
    company: {
      id: "boehringer",
      name: "Boehringer Ingelheim",
      careersUrl: "https://jobs.boehringer-ingelheim.com/search/"
    },
    kind: "sap_html",
    sap: { pageSize: 100, maxStart: 5000 }
  },

  // Workday boards
  {
    company: {
      id: "immatics",
      name: "Immatics",
      careersUrl: "https://immatics.wd3.myworkdayjobs.com/Immatics_External"
    },
    kind: "workday",
    workday: {
      host: "immatics.wd3.myworkdayjobs.com",
      tenant: "immatics",
      site: "Immatics_External"
    }
  },
  {
    company: {
      id: "gsk",
      name: "GSK",
      careersUrl: "https://gsk.wd5.myworkdayjobs.com/GSKCareers"
    },
    kind: "workday",
    workday: {
      host: "gsk.wd5.myworkdayjobs.com",
      tenant: "gsk",
      site: "GSKCareers"
    }
  }
];
