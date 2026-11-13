"use client";

import { classroomApi } from "./classroom";
import {
  authApi,
  invalidateDirectoryCache,
  invalidateEtagCache,
  invalidateGroupStatusCache,
} from "./client";
import { ApiError, AuthSupersededError } from "./errors";
import {
  apiConstraints,
  apiCurriculums,
  apiGenerator,
  apiImporter,
  apiSchedulePeriods,
  apiTerms,
  directoryApi,
  groupsDirectory,
  referencesApi,
  usersApi,
} from "./planning";
import {
  datedApi,
  educationalProcess,
  eventsApi,
  lessonsApi,
  notesApi,
  publicationsApi,
  scheduleVersionsApi,
  settingsApi,
  statistics,
  templateApi,
  today,
  week,
} from "./schedule";

export * from "./types";
export {
  ApiError,
  AuthSupersededError,
  invalidateDirectoryCache,
  invalidateEtagCache,
  invalidateGroupStatusCache,
  apiTerms,
  apiCurriculums,
  apiSchedulePeriods,
  apiGenerator,
  apiConstraints,
  apiImporter,
};

export const api = {
  publications: publicationsApi,
  notes: notesApi,
  importer: apiImporter,
  constraints: apiConstraints,
  generator: apiGenerator,
  terms: apiTerms,
  curriculums: apiCurriculums,
  calendarPeriods: apiSchedulePeriods,
  auth: authApi,
  groups: groupsDirectory,
  directory: directoryApi,
  users: usersApi,
  references: referencesApi,
  today,
  week,
  statistics,
  educationalProcess,
  settings: settingsApi,
  scheduleVersions: scheduleVersionsApi,
  lessons: lessonsApi,
  dated: datedApi,
  template: templateApi,
  events: eventsApi,
  classroom: classroomApi,
};
