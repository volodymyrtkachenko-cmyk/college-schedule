"use client";

import { GuideHubModal } from "./GuideHubModal";
import { StudentOnboardingModal } from "./StudentOnboardingModal";

export interface StudentGuideModalProps {
  isOnboarding?: boolean;
  groupId?: number | null;
  teacherId?: number | null;
  mode?: "student" | "teacher";
  onClose: () => void;
  onComplete?: (finalGroupId?: number | null) => void;
}

export function StudentGuideModal({
  isOnboarding = false,
  groupId,
  teacherId,
  mode,
  onClose,
  onComplete,
}: StudentGuideModalProps) {
  if (isOnboarding) {
    return (
      <StudentOnboardingModal
        groupId={groupId ?? 1}
        onClose={onClose}
        onComplete={onComplete ?? onClose}
      />
    );
  }

  return <GuideHubModal groupId={groupId} teacherId={teacherId} mode={mode} onClose={onClose} />;
}

export { GuideHubModal, StudentOnboardingModal };
