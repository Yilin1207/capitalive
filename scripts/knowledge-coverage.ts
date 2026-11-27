import { knowledgeCoverage, RULES } from "../lib/knowledge/rules";
console.log(
  JSON.stringify(
    {
      ...knowledgeCoverage(),
      rule_details: RULES.map((r) => ({
        id: r.id,
        status: r.status,
        specification: r.specification,
        source_ids: r.source_ids,
        unresolved: r.unresolved,
        validation: r.validation,
      })),
    },
    null,
    2,
  ),
);
