import emailjs from '@emailjs/browser';

export const SUMMARY_REPORT_EMAIL = 'lily_lv@sdmctech.com';

const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || '';
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || '';
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || '';

function normalize(value) {
  return String(value || '').trim();
}

export function canAutoSendSummaryReportEmail() {
  return Boolean(
    normalize(EMAILJS_SERVICE_ID)
    && normalize(EMAILJS_TEMPLATE_ID)
    && normalize(EMAILJS_PUBLIC_KEY)
  );
}

export async function sendSummaryReportEmailAuto(reportPayload, toEmail = SUMMARY_REPORT_EMAIL) {
  if (!canAutoSendSummaryReportEmail()) {
    throw new Error('EmailJS is not configured');
  }

  const environment = normalize(reportPayload?.testEnvironment) || 'Unknown';
  const subject = `VoiceAuto 总结报告 - ${environment}`;
  const message = String(reportPayload?.text || '').slice(0, 5000);

  await emailjs.send(
    EMAILJS_SERVICE_ID,
    EMAILJS_TEMPLATE_ID,
    {
      to_email: normalize(toEmail),
      subject,
      message,
      report_environment: environment,
      report_generated_at: normalize(reportPayload?.generatedAtText),
      report_pass_rate: normalize(reportPayload?.passRate),
      report_executed_cases: String(reportPayload?.executedCases ?? ''),
    },
    { publicKey: EMAILJS_PUBLIC_KEY }
  );

  return { subject, toEmail: normalize(toEmail) };
}

export function openSummaryReportMailClient(reportPayload, toEmail = SUMMARY_REPORT_EMAIL) {
  const subject = encodeURIComponent(`VoiceAuto 总结报告 - ${reportPayload?.testEnvironment || 'Unknown'}`);
  const body = encodeURIComponent(String(reportPayload?.text || '').slice(0, 1800));
  window.location.href = `mailto:${normalize(toEmail)}?subject=${subject}&body=${body}`;
}
