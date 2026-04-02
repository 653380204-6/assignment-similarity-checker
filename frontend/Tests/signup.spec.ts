import { test, expect, Page } from "@playwright/test";

const SIGNUP_URL = "http://localhost:3000/signup";

async function gotoSignup(page: Page) {
  await page.goto(SIGNUP_URL);
}

async function fillSignupForm(
  page: Page,
  data?: {
    fullName?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }
) {
  const {
    fullName = "Test User",
    email = "test@example.com",
    password = "123456",
    confirmPassword = "123456",
  } = data || {};

  await page.getByPlaceholder("Enter your name").fill(fullName);
  await page.getByPlaceholder("user@example.com").fill(email);
  await page.getByPlaceholder("At least 6 characters").fill(password);
  await page.getByPlaceholder("Confirm your password").fill(confirmPassword);
}

test.describe("Signup Page", () => {
  test("เปิดหน้าสมัครสมาชิกได้", async ({ page }) => {
    await gotoSignup(page);

    await expect(page.getByText("สมัครสมาชิก")).toBeVisible();
    await expect(
        page.getByRole("link", { name: "เข้าสู่ระบบ" }).first()
    ).toBeVisible();

    await expect(
        page.getByRole("link", { name: "เข้าสู่ระบบ" })
    ).toHaveCount(2);

    await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
    await expect(page.getByPlaceholder("user@example.com")).toBeVisible();
    await expect(page.getByPlaceholder("At least 6 characters")).toBeVisible();
    await expect(page.getByPlaceholder("Confirm your password")).toBeVisible();

    await expect(page.getByRole("button", { name: /sign up/i })).toBeVisible();
  });

  test("ค่าเริ่มต้นของฟอร์มต้องว่าง", async ({ page }) => {
    await gotoSignup(page);

    await expect(page.getByPlaceholder("Enter your name")).toHaveValue("");
    await expect(page.getByPlaceholder("user@example.com")).toHaveValue("");
    await expect(page.getByPlaceholder("At least 6 characters")).toHaveValue("");
    await expect(page.getByPlaceholder("Confirm your password")).toHaveValue("");
  });

  test("ช่อง email ต้องเป็น type email", async ({ page }) => {
    await gotoSignup(page);

    await expect(page.getByPlaceholder("user@example.com")).toHaveAttribute(
      "type",
      "email"
    );
  });

  test("ช่อง password และ confirm password ต้องเป็น type password ตอนเริ่มต้น", async ({
    page,
  }) => {
    await gotoSignup(page);

    await expect(page.getByPlaceholder("At least 6 characters")).toHaveAttribute(
      "type",
      "password"
    );
    await expect(
      page.getByPlaceholder("Confirm your password")
    ).toHaveAttribute("type", "password");
  });

  test("กด toggle password แล้วต้องสลับ show hide ได้", async ({ page }) => {
    await gotoSignup(page);

    const passwordInput = page.getByPlaceholder("At least 6 characters");
    const togglePasswordBtn = page.getByRole("button", {
      name: "toggle-password",
    });

    await passwordInput.fill("123456");
    await expect(passwordInput).toHaveAttribute("type", "password");

    await togglePasswordBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "text");

    await togglePasswordBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("กด toggle confirm password แล้วต้องสลับ show hide ได้", async ({
    page,
  }) => {
    await gotoSignup(page);

    const confirmInput = page.getByPlaceholder("Confirm your password");
    const toggleConfirmBtn = page.getByRole("button", {
      name: "toggle-confirm-password",
    });

    await confirmInput.fill("123456");
    await expect(confirmInput).toHaveAttribute("type", "password");

    await toggleConfirmBtn.click();
    await expect(confirmInput).toHaveAttribute("type", "text");

    await toggleConfirmBtn.click();
    await expect(confirmInput).toHaveAttribute("type", "password");
  });

  test("ถ้า password กับ confirm password ไม่ตรงกัน ต้องขึ้น error และต้องไม่ยิง API", async ({
    page,
  }) => {
    let apiCalled = false;

    await page.route("**/auth/signup", async (route) => {
      apiCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoSignup(page);
    await fillSignupForm(page, {
      password: "123456",
      confirmPassword: "654321",
    });

    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(
      page.getByText("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน")
    ).toBeVisible();

    expect(apiCalled).toBeFalsy();
  });

  test("ถ้า backend ตอบว่าอีเมลซ้ำ ต้องแปลงเป็นข้อความไทยที่กำหนด", async ({
    page,
  }) => {
    await page.route("**/auth/signup", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "User already registered",
        }),
      });
    });

    await gotoSignup(page);
    await fillSignupForm(page);

    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(
      page.getByText("อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่นหรือเข้าสู่ระบบ")
    ).toBeVisible();
  });

  test("ถ้า backend ส่ง error ทั่วไป ต้องแสดง detail ที่ส่งกลับมา", async ({
    page,
  }) => {
    await page.route("**/auth/signup", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "สมัครสมาชิกไม่สำเร็จจากระบบทดสอบ",
        }),
      });
    });

    await gotoSignup(page);
    await fillSignupForm(page);

    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(
      page.getByText("สมัครสมาชิกไม่สำเร็จจากระบบทดสอบ")
    ).toBeVisible();
  });

  test("ถ้า backend ล่มหรือ network error ต้องขึ้นข้อความ fallback", async ({
    page,
  }) => {
    await page.route("**/auth/signup", async (route) => {
      await route.abort();
    });

    await gotoSignup(page);
    await fillSignupForm(page);

    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(
      page.getByText("สมัครสมาชิกไม่สำเร็จ")
    ).toBeVisible();
  });

  test("ตอน submit ต้องเห็นสถานะ Signing Up และปุ่มถูก disabled ชั่วคราว", async ({
    page,
  }) => {
    await page.route("**/auth/signup", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "ok" }),
      });
    });

    await gotoSignup(page);
    await fillSignupForm(page);

    const submitButton = page.getByRole("button", { name: /sign up/i });
    await submitButton.click();

    await expect(page.getByRole("button", { name: "Signing Up..." })).toBeDisabled();

    await expect(
      page.getByText("สมัครสมาชิกสำเร็จแล้ว กรุณาเข้าสู่ระบบ")
    ).toBeVisible();
  });

  test("สมัครสมาชิกสำเร็จ ต้องขึ้น success message และล้างค่าฟอร์ม", async ({
    page,
  }) => {
    await page.route("**/auth/signup", async (route) => {
      const body = route.request().postDataJSON();

      expect(body).toEqual({
        email: "test@example.com",
        password: "123456",
        full_name: "Test User",
      });

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "ok" }),
      });
    });

    await gotoSignup(page);
    await fillSignupForm(page);

    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(
      page.getByText("สมัครสมาชิกสำเร็จแล้ว กรุณาเข้าสู่ระบบ")
    ).toBeVisible();

    await expect(page.getByPlaceholder("Enter your name")).toHaveValue("");
    await expect(page.getByPlaceholder("user@example.com")).toHaveValue("");
    await expect(page.getByPlaceholder("At least 6 characters")).toHaveValue("");
    await expect(page.getByPlaceholder("Confirm your password")).toHaveValue("");
  });

  test("สมัครสมาชิกสำเร็จ ต้องมีปุ่มไปหน้าเข้าสู่ระบบเพิ่มขึ้นมา", async ({
    page,
  }) => {
    await page.route("**/auth/signup", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "ok" }),
      });
    });

    await gotoSignup(page);
    await fillSignupForm(page);

    await page.getByRole("button", { name: /sign up/i }).click();

    const successLoginLink = page.getByRole("link", {
      name: "ไปหน้าเข้าสู่ระบบ",
    });

    await expect(successLoginLink).toBeVisible();
    await expect(successLoginLink).toHaveAttribute("href", "/login");
  });

  test("ลิงก์เข้าสู่ระบบด้านล่างต้องพาไปหน้า login ได้", async ({ page }) => {
    await gotoSignup(page);

    const links = page.getByRole("link", { name: "เข้าสู่ระบบ" });

    await expect(links.first()).toHaveAttribute("href", "/login");
    await links.first().click();

    await expect(page).toHaveURL(/\/login$/);
  });

  test("กรอกอีเมลผิดรูปแบบต้องไม่ผ่าน native validation", async ({ page }) => {
    await gotoSignup(page);

    const emailInput = page.getByPlaceholder("user@example.com");

    await page.getByPlaceholder("Enter your name").fill("Test User");
    await emailInput.fill("testexample.com");
    await page.getByPlaceholder("At least 6 characters").fill("123456");
    await page.getByPlaceholder("Confirm your password").fill("123456");

    const isValid = await emailInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );

    expect(isValid).toBeFalsy();
  });

  test("กรอก password สั้นกว่า 6 ตัวต้องไม่ผ่าน native validation", async ({
    page,
  }) => {
    await gotoSignup(page);

    const passwordInput = page.getByPlaceholder("At least 6 characters");
    const confirmInput = page.getByPlaceholder("Confirm your password");

    await page.getByPlaceholder("Enter your name").fill("Test User");
    await page.getByPlaceholder("user@example.com").fill("test@example.com");
    await passwordInput.fill("12345");
    await confirmInput.fill("12345");

    const passwordValid = await passwordInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );
    const confirmValid = await confirmInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );

    expect(passwordValid).toBeFalsy();
    expect(confirmValid).toBeFalsy();
  });

  test("ช่อง required ต้องไม่ผ่าน validation ถ้ายังไม่กรอก", async ({ page }) => {
    await gotoSignup(page);

    const fullNameInput = page.getByPlaceholder("Enter your name");
    const emailInput = page.getByPlaceholder("user@example.com");
    const passwordInput = page.getByPlaceholder("At least 6 characters");
    const confirmInput = page.getByPlaceholder("Confirm your password");

    const fullNameValid = await fullNameInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );
    const emailValid = await emailInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );
    const passwordValid = await passwordInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );
    const confirmValid = await confirmInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );

    expect(fullNameValid).toBeFalsy();
    expect(emailValid).toBeFalsy();
    expect(passwordValid).toBeFalsy();
    expect(confirmValid).toBeFalsy();
  });

  test("submit สำเร็จต้องส่ง payload ถูกต้องไปที่ API", async ({ page }) => {
    let requestBody: any = null;
    let requestMethod = "";
    let requestContentType = "";

    await page.route("**/auth/signup", async (route) => {
      requestMethod = route.request().method();
      requestContentType = route.request().headers()["content-type"] || "";
      requestBody = route.request().postDataJSON();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "ok" }),
      });
    });

    await gotoSignup(page);
    await fillSignupForm(page, {
      fullName: "Nithinan",
      email: "nithinan@example.com",
      password: "654321",
      confirmPassword: "654321",
    });

    await page.getByRole("button", { name: /sign up/i }).click();

    expect(requestMethod).toBe("POST");
    expect(requestContentType).toContain("application/json");
    expect(requestBody).toEqual({
      email: "nithinan@example.com",
      password: "654321",
      full_name: "Nithinan",
    });
  });
});