const futureFeatureError = (feature: string) =>
  new Error(`${feature} is planned but not implemented because backend endpoints are unavailable.`);

export const plannedProductFeedbackApi = {
  async voteReviewHelpful(_: { review_id: string; helpful: boolean }): Promise<{ ok: boolean }> {
    throw futureFeatureError("POST /products/reviews/{review_id}/votes");
  },
  async reportReview(_: { review_id: string; reason: string }): Promise<{ ok: boolean }> {
    throw futureFeatureError("POST /products/reviews/{review_id}/report");
  },
  async reportQuestion(_: { question_id: string; reason: string }): Promise<{ ok: boolean }> {
    throw futureFeatureError("POST /products/questions/{question_id}/report");
  },
  async pinOfficialAnswer(_: { answer_id: string }): Promise<{ ok: boolean }> {
    throw futureFeatureError("POST /products/answers/{answer_id}/pin");
  }
};
