import { ContentField, ContentType } from "../issue";

interface NamedObject {
  name: string;
}

/*
 * **Summary** – A short description of the change request.
 * **Reporter** – The person who submitted the change request.
 * **Components** – Segments of your IT infrastructure that relate to the request. For example, Billing services or VPN server. These are used for labeling, categorization, and reporting.
 * **Attachment** – Files or images added to the change request.
 * **Description** – A more detailed description of the change request.
 * **Linked Issues** – A list of other work items that affect (or are affected by) the change request. If your business uses other Atlassian products, this list may include linked development work items.
 * **Assignee** – The team member assigned to work on the change request.
 * **Priority** – The importance of the change request’s resolution, usually in regards to your business needs and goals. Sometimes, priority is calculated by impact and urgency.
 * **Labels** – A list of extra custom labels used for categorizing or querying records.
 * **Request participants** – A list of extra customers who take part in the change request, for example, people from other teams, or vendors.
 * **Approvers** – A list of people responsible for approving the change request, usually business, financial or technical contacts.
 * **Organizations** – A list of customer groups interested in the change request’s resolution. Learn more about organizations in Jira Service Management.
 * **Impact** – The effect of the change, usually in regards to service level agreements.
 * **Urgency** – The time available before the business feels any impact.
 * **Change type** – The category of the change (usually standard, normal, or emergency). For example, a standard change does not require action from change managers. A normal change does.
 * **Change reason** – A short description or code that indicates why the reporter needs the change.
 * **Change risk** – The risk of implementing the change determined by the change advisory board. Usually based on complexity, scope, testing, recovery, timing, etc.
 * **Planned start** – when the change request is planned to start. This field is required for change requests to appear on the change calendar. Learn more about date fields and the change calendar.
 * **Planned end** – when the change request is planned to end. This field is required for change requests to appear on the change calendar.
 * **Implementation plan**
 * **Test plan**
 * **Backout plan**
 */
export const changeContentFields: Array<ContentField> = [
  { name: "Issue Type", type: ContentType.Frontmatter },
  { name: "Summary", type: ContentType.Specified },
  { name: "Reporter", type: ContentType.Frontmatter },
  { name: "Components", type: ContentType.Frontmatter },
  { name: "Attachment", type: ContentType.Specified },
  { name: "Description", type: ContentType.Specified },
  { name: "Linked Issues", type: ContentType.Specified },
  { name: "Assignee", type: ContentType.Frontmatter },
  { name: "Priority", type: ContentType.Frontmatter },
  { name: "Labels", type: ContentType.Frontmatter },
  { name: "Request participants", type: ContentType.Frontmatter },
  { name: "Approvers", type: ContentType.Frontmatter },
  { name: "Organizations", type: ContentType.Frontmatter },
  { name: "Impact", type: ContentType.Frontmatter },
  { name: "Urgency", type: ContentType.Frontmatter },
  { name: "Change type", type: ContentType.Frontmatter },
  { name: "Change reason", type: ContentType.Frontmatter },
  { name: "Change risk", type: ContentType.Frontmatter },
  { name: "Planned start", type: ContentType.Frontmatter },
  { name: "Planned end", type: ContentType.Frontmatter },
  { name: "Status", type: ContentType.Frontmatter },
  { name: "Implementation plan", type: ContentType.Rendered },
  { name: "Test plan", type: ContentType.Rendered },
  { name: "Backout plan", type: ContentType.Rendered },
];

export interface ChangeFields {
  issuetype: NamedObject;
  summary: string;
  // reporter: User;
  // components?: Compontent[];
  // attachment?: Attachment[];
  description?: string;
  // linkedIssues?: Issue[];
  assignee?: NamedObject;
  priority?: NamedObject;
  // approvers?: Users[];
  // organizations?: Organization[];
  // impact?: ?
  // urgency?: ?
  // changeType?: ?
  // changeReason?: ?
  // changeRisk?: ?
  // plannedStart?: ResultDate;
  // plannedEnd?: ResultDate;
  status: NamedObject;
  // updated: ResultDate;
  implmementationPlan: string;
  testPlan: string;
  backoutPlan: string;
}

interface ChangeCard {
  key: string;
  url: string;
  issuetype: string;
  summary: string;
  reporter: string;
  components?: string[];
  // attachment?: ?
  description?: string;
  linkedIssues?: string[];
  assignee?: string;
  priority?: string;
  approvers?: string[];
  organizations?: string[];
  impact?: string;
  urgency?: string;
  changeType?: string;
  changeReason?: string;
  changeRisk?: string;
  // plannedStart?: ResultDate;
  // plannedEnd?: ResultDate;
  status: string;
  // updated: ResultDate;
  implmementationPlan: string;
  testPlan: string;
  backoutPlan: string;
}
