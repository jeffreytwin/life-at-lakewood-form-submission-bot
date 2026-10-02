/**
 * The queue's label for a tour the weekly review puts to a person
 * (tour-review.ts). Its own, so rejecting one never holds back a dead
 * tour's removal, which is a "virtual tour" change; and its own module, so
 * the review queue's page can name it without the review's database code.
 */
export const TOUR_REVIEW_LABEL = "virtual tour (suspected wrong)";
