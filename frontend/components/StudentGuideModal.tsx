"use client";

import { GuideHubModal } from "./GuideHubModal";
import { StudentOnboardingModal } from "./StudentOnboardingModal";
import { TeacherOnboardingModal } from "./TeacherOnboardingModal";

export interface StudentGuideModalProps {
  isOnboarding?: boolean;
  groupId?: number | null;
  teacherId?: number | null;
  teacherName?: string;
  mode?: "student" | "teacher";
  onClose: () => void;
  onComplete?: (finalId?: number | null) => void;
}

export function StudentGuideModal({
  isOnboarding = false,
  groupId,
  teacherId,
  teacherName,
  mode = "student",
  onClose,
  onComplete,
}: StudentGuideModalProps) {
  if (isOnboarding) {
    if (mode === "teacher" && teacherId) {
      return (
        <TeacherOnboardingModal
          teacherId={teacherId}
          teacherName={teacherName}
          onClose={onClose}
          onComplete={onComplete ?? onClose}
        />
      );
    }
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

export { GuideHubModal, StudentOnboardingModal, TeacherOnboardingModal };
