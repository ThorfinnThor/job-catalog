export const sites = [
  {
    company: {
      id: "biontech",
      name: "BioNTech",
      careersUrl:
        "https://jobs.biontech.com/search/?createNewAlert=false&q=&optionsFacetsDD_location=&optionsFacetsDD_customfield1=&optionsFacetsDD_customfield2="
    },
    kind: "biontech_html"
  },
  {
    company: {
      id: "gsk",
      name: "GSK",
      careersUrl: "https://jobs.gsk.com/en-gb/jobs?location=Germany&page=1"
    },
    kind: "gsk_playwright"
  },
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
  }
];
