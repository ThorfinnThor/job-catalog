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
    careersUrl: "https://gsk.wd5.myworkdayjobs.com/GSKCareers"
  },
  kind: "workday",
  workday: {
    host: "gsk.wd5.myworkdayjobs.com",
    tenant: "gsk",
    site: "GSKCareers"
  }
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
