import { test, expect, Page } from "@playwright/test";

const CLUSTER_URL = "http://localhost:3000/cluster";

type CompareItem = {
  doc_1: string;
  doc_2: string;
  combined_score?: number;
  final_score?: number;
};

type DocItem = {
  doc_id: string;
  file_name?: string;
};

type ClusterCache = {
  threshold: number;
  clusters: string[][];
};

type ClusterMockOptions = {
  docs?: DocItem[];
  compareResults?: CompareItem[];
  clusterResponse?: {
    threshold?: number;
    clusters?: string[][];
  };
};

function makeFakeJwt() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    })
  ).toString("base64");

  return `test.${payload}.test`;
}

async function seedSession(
  page: Page,
  options?: {
    batchId?: string | null;
    compareCache?: CompareItem[] | null;
    clusterCache?: ClusterCache | null;
  }
) {
  const fakeJwt = makeFakeJwt();
  const batchId = options?.batchId ?? null;
  const compareCache = options?.compareCache ?? null;
  const clusterCache = options?.clusterCache ?? null;

  await page.addInitScript(
    ({ fakeJwt, batchId, compareCache, clusterCache }) => {
      sessionStorage.setItem("access_token", fakeJwt);

      if (batchId) {
        sessionStorage.setItem("last_batch_id", batchId);
      }

      if (batchId && compareCache) {
        sessionStorage.setItem(
          `compare_cache:${batchId}`,
          JSON.stringify(compareCache)
        );
        sessionStorage.setItem(
          "last_compare_batch_id",
          batchId
        );
      }

      if (batchId && clusterCache) {
        sessionStorage.setItem(
          `cluster_cache:${batchId}`,
          JSON.stringify(clusterCache)
        );
      }
    },
    { fakeJwt, batchId, compareCache, clusterCache }
  );
}

async function mockClusterApis(page: Page, options?: ClusterMockOptions) {
  const docs: DocItem[] =
    options?.docs ??
    [
      { doc_id: "doc_001", file_name: "alpha.pdf" },
      { doc_id: "doc_002", file_name: "beta.pdf" },
      { doc_id: "doc_003", file_name: "gamma.pdf" },
      { doc_id: "doc_004", file_name: "delta.pdf" },
    ];

  const compareResults: CompareItem[] =
    options?.compareResults ??
    [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
      { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
      { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
    ];

  const clusterResponse =
    options?.clusterResponse ?? {
      threshold: 0.92,
      clusters: [
        ["doc_001", "doc_002"],
        ["doc_003", "doc_004"],
      ],
    };

  await page.route(/\/auth\/me(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_001",
        email: "test@example.com",
        name: "Test User",
      }),
    });
  });

  await page.route(/\/documents(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(docs),
    });
  });

  await page.route(/\/compare(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(compareResults),
    });
  });

  await page.route(/\/cluster$/, async (route) => {
  if (route.request().method() !== "POST") {
    await route.fallback();
    return;
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      threshold: clusterResponse.threshold ?? 0.92,
      clusters: clusterResponse.clusters ?? [],
    }),
  });
});

  await page.route(/\/documents\/[^/]+\/preview-url(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const docId = parts[parts.length - 2];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: `https://example.com/storage/${docId}.pdf`,
      }),
    });
  });

  await page.route(/https:\/\/example\.com\/storage\/.*\.pdf$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from("%PDF-1.4 mock pdf content"),
    });
  });
}

test.describe("Cluster Page", () => {
  test("เปิดหน้า cluster ได้และเห็นส่วนควบคุมหลัก", async ({ page }) => {
    await seedSession(page, { batchId: "batch_001" });
    await mockClusterApis(page);

    await page.goto(CLUSTER_URL);

    await expect(page).toHaveURL(/cluster/);
    await expect(page.locator('input[type="number"]').first()).toBeVisible();
    await expect(page.getByText("ข้อมูลชุดปัจจุบัน")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "โหลดผลเปรียบเทียบล่าสุด" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "หาผลลัพธ์เอกสาร" })
    ).toBeVisible();
    await expect(
        page.locator("span.font-medium").filter({ hasText: "จำนวนเอกสาร" })
    ).toBeVisible();

    await expect(
        page.locator("span.font-medium").filter({ hasText: "จำนวนคู่เอกสาร" })
    ).toBeVisible();
  });

  test("กดโหลดผลเปรียบเทียบล่าสุดได้", async ({ page }) => {
    await seedSession(page, { batchId: "batch_001" });
    await mockClusterApis(page);

    await page.goto(CLUSTER_URL);

    await page.getByRole("button", { name: "โหลดผลเปรียบเทียบล่าสุด" }).click();

    await expect(
      page.locator("button").filter({ hasText: "0.90" }).first()
    ).toBeVisible();

    await expect(
      page.locator("button").filter({ hasText: "0.92" }).first()
    ).toBeVisible();

    await expect(
      page.locator("button").filter({ hasText: "0.94" }).first()
    ).toBeVisible();
  });

  test("กดค่าแนะนำ threshold แล้วค่าใน input เปลี่ยน", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
      { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
      { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
    ];

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
    });
    await mockClusterApis(page);

    await page.goto(CLUSTER_URL);

    const thresholdInput = page.locator('input[type="number"]').first();
    await expect(thresholdInput).toBeVisible();
    await expect(thresholdInput).toHaveValue("0.8");

    await page.locator("button").filter({ hasText: "0.92" }).first().click();

    await expect(thresholdInput).toHaveValue("0.92");
  });

  test("กดหาผลลัพธ์เอกสารแล้วแสดงกลุ่มได้", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.95 },
      { doc_1: "doc_001", doc_2: "doc_003", final_score: 0.82 },
      { doc_1: "doc_003", doc_2: "doc_004", final_score: 0.71 },
    ];

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
    });

    await mockClusterApis(page, {
      clusterResponse: {
        threshold: 0.92,
        clusters: [
          ["doc_001", "doc_002"],
          ["doc_003", "doc_004"],
        ],
      },
    });

    await page.goto(CLUSTER_URL);

    await page.getByRole("button", { name: "หาผลลัพธ์เอกสาร" }).click();

    await expect(
      page.getByRole("heading", { name: "ผลลัพธ์เอกสาร" })
    ).toBeVisible();

    await expect(page.getByText("พบ 2 กลุ่ม")).toBeVisible();
    await expect(page.getByText("กลุ่ม 1")).toBeVisible();
    await expect(page.getByText("กลุ่ม 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "alpha.pdf" })).toBeVisible();
    await expect(page.getByRole("button", { name: "beta.pdf" })).toBeVisible();
  });

  test("โหลด cluster cache เดิมแล้วแสดงผลทันที", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.88 },
    ];

    const clusterCache: ClusterCache = {
      threshold: 0.88,
      clusters: [["doc_001", "doc_002"]],
    };

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
      clusterCache,
    });

    await mockClusterApis(page, {
      docs: [
        { doc_id: "doc_001", file_name: "cached-a.pdf" },
        { doc_id: "doc_002", file_name: "cached-b.pdf" },
      ],
    });

    await page.goto(CLUSTER_URL);

    await expect(
      page.getByRole("heading", { name: "ผลลัพธ์เอกสาร" })
    ).toBeVisible();

    await expect(page.locator('input[type="number"]').first()).toHaveValue("0.88");
    await expect(page.getByText("พบ 1 กลุ่ม")).toBeVisible();
    await expect(page.getByRole("button", { name: "cached-a.pdf" })).toBeVisible();
    await expect(page.getByRole("button", { name: "cached-b.pdf" })).toBeVisible();
  });

  test("Export CSV ได้เมื่อมีผลลัพธ์กลุ่ม", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.88 },
    ];

    const clusterCache: ClusterCache = {
      threshold: 0.88,
      clusters: [["doc_001", "doc_002"]],
    };

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
      clusterCache,
    });

    await mockClusterApis(page);

    await page.goto(CLUSTER_URL);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^clusters_.*\.csv$/);
  });

  test("เปิด modal ดูเอกสารในกลุ่มและเปิดพรีวิวเต็มได้", async ({ page }) => {
    const compareCache: CompareItem[] = [
      { doc_1: "doc_001", doc_2: "doc_002", final_score: 0.88 },
    ];

    const clusterCache: ClusterCache = {
      threshold: 0.88,
      clusters: [["doc_001", "doc_002"]],
    };

    await seedSession(page, {
      batchId: "batch_001",
      compareCache,
      clusterCache,
    });

    await mockClusterApis(page, {
      docs: [
        { doc_id: "doc_001", file_name: "alpha.pdf" },
        { doc_id: "doc_002", file_name: "beta.pdf" },
      ],
    });

    await page.goto(CLUSTER_URL);

    await page.getByRole("button", { name: "ดูเอกสารในกลุ่ม" }).first().click();

    await expect(
      page.getByRole("heading", { name: /พรีวิวเอกสารในกลุ่ม 1/ })
    ).toBeVisible();

    await expect(page.getByText("เลือกไฟล์ในกลุ่ม")).toBeVisible();
    await expect(page.getByRole("button", { name: "alpha.pdf" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "beta.pdf" }).first()).toBeVisible();

    await page.getByRole("button", { name: "เปิดเต็ม" }).first().click();

    await expect(
      page.getByRole("heading", { name: /เอกสาร alpha\.pdf/ })
    ).toBeVisible();
  });
});