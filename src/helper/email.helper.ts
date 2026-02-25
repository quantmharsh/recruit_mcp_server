export function generateOtpEmail(name: string, otp: string) {
  return `
    <div style="font-family: Arial;">
      <h2>RecruitMCP Login Verification</h2>
      <p>Hello ${name},</p>
      <p>Your OTP is:</p>
      <h1 style="letter-spacing:4px;">${otp}</h1>
      <p>This code expires in 5 minutes.</p>
    </div>
  `;
}