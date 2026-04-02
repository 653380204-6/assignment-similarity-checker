import { test, expect, Page } from "@playwright/test";

const LOGIN_URL = "http://localhost:3000/login";

async function gotoLogin(page: Page) {
  await page.goto(LOGIN_URL);
}

async function fillLoginForm(
  page: Page,
  data?: {
    email?: string;
    password?: string;
  }
) {
  const {
    email = "test@example.com",
    password = "123456",
  } = data || {};

  await page.getByPlaceholder("Enter your email address").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
}

test.describe("Login Page", () => {
  test("เปิดหน้าเข้าสู่ระบบได้", async ({ page }) => {
    await gotoLogin(page);

    await expect(page.getByText("เข้าสู่ระบบ")).toBeVisible();

    await expect(
      page.getByRole("link", { name: "สมัครสมาชิก" }).first()
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "สมัครสมาชิก" })
    ).toHaveCount(2);

    await expect(
      page.getByPlaceholder("Enter your email address")
    ).toBeVisible();

    await expect(
      page.getByPlaceholder("Enter your password")
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /log in/i })
    ).toBeVisible();
  });

  test("ค่าเริ่มต้นของฟอร์มต้องว่าง", async ({ page }) => {
    await gotoLogin(page);

    await expect(
      page.getByPlaceholder("Enter your email address")
    ).toHaveValue("");

    await expect(
      page.getByPlaceholder("Enter your password")
    ).toHaveValue("");
  });

  test("ช่อง email ต้องเป็น type email", async ({ page }) => {
    await gotoLogin(page);

    await expect(
      page.getByPlaceholder("Enter your email address")
    ).toHaveAttribute("type", "email");
  });

  test("ช่อง password ต้องเป็น type password ตอนเริ่มต้น", async ({ page }) => {
    await gotoLogin(page);

    await expect(
      page.getByPlaceholder("Enter your password")
    ).toHaveAttribute("type", "password");
  });

  test("กด toggle password แล้วต้องสลับ show hide ได้", async ({ page }) => {
    await gotoLogin(page);

    const passwordInput = page.getByPlaceholder("Enter your password");
    const toggleBtn = page.getByRole("button", {
      name: /toggle-password|show password|hide password/i,
    });

    await passwordInput.fill("123456");
    await expect(passwordInput).toHaveAttribute("type", "password");

    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "text");

    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("ลิงก์สมัครสมาชิกด้านล่างต้องพาไปหน้า signup ได้", async ({ page }) => {
    await gotoLogin(page);

    const links = page.getByRole("link", { name: "สมัครสมาชิก" });

    await expect(links.first()).toHaveAttribute("href", "/signup");
    await links.first().click();

    await expect(page).toHaveURL(/\/signup$/);
  });

  test("กรอกอีเมลผิดรูปแบบต้องไม่ผ่าน native validation", async ({ page }) => {
    await gotoLogin(page);

    const emailInput = page.getByPlaceholder("Enter your email address");

    await emailInput.fill("testexample.com");
    await page.getByPlaceholder("Enter your password").fill("123456");

    const isValid = await emailInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );

    expect(isValid).toBeFalsy();
  });

  test("ช่อง required ต้องไม่ผ่าน validation ถ้ายังไม่กรอก", async ({ page }) => {
    await gotoLogin(page);

    const emailInput = page.getByPlaceholder("Enter your email address");
    const passwordInput = page.getByPlaceholder("Enter your password");

    const emailValid = await emailInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );

    const passwordValid = await passwordInput.evaluate(
      (el) => (el as HTMLInputElement).checkValidity()
    );

    expect(emailValid).toBeFalsy();
    expect(passwordValid).toBeFalsy();
  });

  test("กรอก password สั้นกว่า 6 ตัว ถ้าหน้าคุณกำหนด minLength ไว้ ต้องไม่ผ่าน native validation", async ({
    page,
  }) => {
    await gotoLogin(page);

    const passwordInput = page.getByPlaceholder("Enter your password");

    await page.getByPlaceholder("Enter your email address").fill("test@example.com");
    await passwordInput.fill("12345");

    const hasMinLength = await passwordInput.evaluate(
      (el) => (el as HTMLInputElement).minLength
    );

    if (hasMinLength && hasMinLength > 0) {
      const isValid = await passwordInput.evaluate(
        (el) => (el as HTMLInputElement).checkValidity()
      );
      expect(isValid).toBeFalsy();
    }
  });

  test("ถ้า backend ตอบ login สำเร็จ ต้องแสดงผลสำเร็จหรือพาไปหน้าถัดไป", async ({
    page,
  }) => {
    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock_token_123",
          token_type: "bearer",
        }),
      });
    });

    await gotoLogin(page);
    await fillLoginForm(page);

    await page.getByRole("button", { name: /log in/i }).click();

    await page.waitForTimeout(500);

    const url = page.url();
    const hasToken = await page.evaluate(() =>
      sessionStorage.getItem("access_token")
    );

    expect(url.includes("/dashboard") || hasToken === "mock_token_123").toBeTruthy();
  });

  test("submit สำเร็จต้องส่ง payload ถูกต้องไปที่ API", async ({ page }) => {
    let requestBody: any = null;
    let requestMethod = "";
    let requestContentType = "";

    await page.route("**/auth/login", async (route) => {
      requestMethod = route.request().method();
      requestContentType = route.request().headers()["content-type"] || "";
      requestBody = route.request().postDataJSON();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock_token_123",
          token_type: "bearer",
        }),
      });
    });

    await gotoLogin(page);
    await fillLoginForm(page, {
      email: "nithinan@example.com",
      password: "654321",
    });

    await page.getByRole("button", { name: /log in/i }).click();

    expect(requestMethod).toBe("POST");
    expect(requestContentType).toContain("application/json");
    expect(requestBody).toEqual({
      email: "nithinan@example.com",
      password: "654321",
    });
  });

  test("ถ้า backend ตอบว่าอีเมลหรือรหัสผ่านผิด ต้องแสดงข้อความ error", async ({
    page,
  }) => {
    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Invalid email or password",
        }),
      });
    });

    await gotoLogin(page);
    await fillLoginForm(page);

    await page.getByRole("button", { name: /log in/i }).click();

    await expect(
      page.locator("text=Invalid email or password").or(
        page.locator("text=อีเมลหรือรหัสผ่านไม่ถูกต้อง")
      )
    ).toBeVisible();
  });

  test("ถ้า backend ส่ง error ทั่วไป ต้องแสดง detail ที่ส่งกลับมา", async ({
    page,
  }) => {
    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "เข้าสู่ระบบไม่สำเร็จจากระบบทดสอบ",
        }),
      });
    });

    await gotoLogin(page);
    await fillLoginForm(page);

    await page.getByRole("button", { name: /log in/i }).click();

    await expect(
      page.getByText("เข้าสู่ระบบไม่สำเร็จจากระบบทดสอบ")
    ).toBeVisible();
  });

  test("ถ้า backend ล่มหรือ network error ต้องขึ้นข้อความ fallback", async ({
    page,
  }) => {
    await page.route("**/auth/login", async (route) => {
      await route.abort();
    });

    await gotoLogin(page);
    await fillLoginForm(page);

    await page.getByRole("button", { name: /log in/i }).click();

    await expect(
      page.locator("text=เข้าสู่ระบบไม่สำเร็จ").or(
        page.locator("text=Login failed")
      )
    ).toBeVisible();
  });

  test("ตอน submit ต้องเห็นสถานะ loading และปุ่มถูก disabled ชั่วคราว", async ({
    page,
  }) => {
    await page.route("**/auth/login", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock_token_123",
          token_type: "bearer",
        }),
      });
    });

    await gotoLogin(page);
    await fillLoginForm(page);

    const submitButton = page.getByRole("button", { name: /log in/i });
    await submitButton.click();

    await expect(
      page.getByRole("button", { name: /logging in|loading|log in/i })
    ).toBeDisabled();
  });

  test("ถ้า login สำเร็จ ต้องเก็บ access token ใน sessionStorage ถ้าโค้ดคุณทำแบบนี้", async ({
    page,
  }) => {
    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock_token_abc",
          token_type: "bearer",
        }),
      });
    });

    await gotoLogin(page);
    await fillLoginForm(page);

    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForTimeout(500);

    const token = await page.evaluate(() => sessionStorage.getItem("access_token"));

    if (token !== null) {
      expect(token).toBe("mock_token_abc");
    }
  });

  test("กด submit ซ้ำระหว่าง loading ไม่ควรยิง request ซ้ำหลายครั้ง", async ({
    page,
  }) => {
    let requestCount = 0;

    await page.route("**/auth/login", async (route) => {
      requestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock_token_123",
          token_type: "bearer",
        }),
      });
    });

    await gotoLogin(page);
    await fillLoginForm(page);

    const submitButton = page.getByRole("button", { name: /log in/i });

    await submitButton.click();
    await submitButton.click();
    await submitButton.click();

    await page.waitForTimeout(1500);

    expect(requestCount).toBe(1);
  });
});