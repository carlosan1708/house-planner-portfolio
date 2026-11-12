/** A workflow claim that is validated and recorded in the same transaction as the business action. */
export type AgentWrite = {
  validate: (transaction: FirebaseFirestore.Transaction) => Promise<void>;
  record: (transaction: FirebaseFirestore.Transaction, recordId: string) => void;
};
