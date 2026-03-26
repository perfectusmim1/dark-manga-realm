export const PASSWORD_MIN_LENGTH = 8;

const PASSWORD_RULE_LABELS = {
  lowercase: '1 küçük harf',
  uppercase: '1 büyük harf',
  digit: '1 rakam',
  symbol: '1 sembol',
} as const;

type PasswordRuleKey = keyof typeof PASSWORD_RULE_LABELS | 'length';

export type PasswordRequirementStatus = {
  tone: 'idle' | 'error' | 'success';
  message: string;
};

const formatMissingPasswordRules = (missingRules: PasswordRuleKey[], minLength: number): string => {
  const labels = missingRules.map((rule) => (
    rule === 'length' ? `en az ${minLength} karakter` : PASSWORD_RULE_LABELS[rule]
  ));

  if (labels.length === 1) {
    return labels[0];
  }

  return labels.join(', ');
};

export const getMissingPasswordRules = (
  password: string,
  minLength = PASSWORD_MIN_LENGTH
): PasswordRuleKey[] => {
  const missingRules: PasswordRuleKey[] = [];

  if (password.length < minLength) {
    missingRules.push('length');
  }

  if (!/[a-z]/.test(password)) {
    missingRules.push('lowercase');
  }

  if (!/[A-Z]/.test(password)) {
    missingRules.push('uppercase');
  }

  if (!/\d/.test(password)) {
    missingRules.push('digit');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    missingRules.push('symbol');
  }

  return missingRules;
};

export const getPasswordPolicyHint = (minLength = PASSWORD_MIN_LENGTH): string =>
  `En az ${minLength} karakter, 1 küçük harf, 1 büyük harf, 1 rakam ve 1 sembol kullanın.`;

export const getPasswordRequirementError = (
  password: string,
  minLength = PASSWORD_MIN_LENGTH
): string | null => {
  const missingRules = getMissingPasswordRules(password, minLength);

  if (missingRules.length === 0) {
    return null;
  }

  return `Şifrede ${formatMissingPasswordRules(missingRules, minLength)} eksik.`;
};

export const getPasswordRequirementStatus = (
  password: string,
  minLength = PASSWORD_MIN_LENGTH
): PasswordRequirementStatus => {
  if (!password) {
    return {
      tone: 'idle',
      message: getPasswordPolicyHint(minLength),
    };
  }

  const error = getPasswordRequirementError(password, minLength);

  if (error) {
    return {
      tone: 'error',
      message: error,
    };
  }

  return {
    tone: 'success',
    message: 'Şifre gereksinimlerini karşılıyor.',
  };
};

export const translatePasswordPolicyError = (
  message: string,
  minLength = PASSWORD_MIN_LENGTH
): string => {
  if (!message) {
    return message;
  }

  const minimumMatch = message.match(/at least\s+(\d+)\s+characters?/i);
  if (minimumMatch) {
    return `Şifre en az ${minimumMatch[1]} karakter olmalı.`;
  }

  if (/password should contain/i.test(message) || /weak password/i.test(message)) {
    return getPasswordPolicyHint(minLength);
  }

  return message;
};
